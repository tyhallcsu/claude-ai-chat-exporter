// ==UserScript==
// @name         Claude AI Chat Exporter
// @namespace    https://tampermonkey.net/
// @version      2026.04.21.2
// @description  Export Claude AI conversations to Markdown from the Claude chat interface.
// @author       sharmanhall
// @match        https://claude.ai/*
// @match        https://app.claude.ai/*
// @icon         https://claude.ai/favicon.ico
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const STATE = {
    isExporting: false,
    conversationData: null,
    originalClipboardText: null,
  };

  const SELECTORS = {
    copyButton: 'button[data-testid="action-bar-copy"]',
    conversationTitle:
      '[data-testid="chat-title-button"] .truncate, button[data-testid="chat-title-button"] div.truncate',
    messageActionsGroup: '[role="group"][aria-label="Message actions"]',
    feedbackButton: 'button[aria-label="Give positive feedback"]',
  };

  const DELAYS = {
    copy: 140,
    startup: 600,
  };

  let interceptedClipboardWrites = [];
  let originalClipboardWriteText = null;

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function sanitizeFilename(name) {
    return (name || 'claude_conversation')
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase()
      .slice(0, 120) || 'claude_conversation';
  }

  function formatTimestamp(isoString) {
    if (!isoString) return null;
    try {
      return new Date(isoString).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch {
      return null;
    }
  }

  function notify(text, title = 'Claude Exporter') {
    try {
      if (typeof GM_notification === 'function') {
        GM_notification({ title, text, timeout: 3500 });
      }
    } catch {}
    console.log(`[Claude Exporter] ${text}`);
  }

  function createStatus() {
    const statusDiv = document.createElement('div');
    statusDiv.id = 'sharmanhall-claude-exporter-status';
    statusDiv.style.cssText = [
      'position: fixed',
      'top: 12px',
      'right: 12px',
      'z-index: 2147483647',
      'background: #1f6feb',
      'color: #fff',
      'padding: 10px 14px',
      'border-radius: 10px',
      'font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      'font-size: 12px',
      'box-shadow: 0 10px 30px rgba(0,0,0,.25)',
      'max-width: 360px',
      'line-height: 1.45',
    ].join(';');
    document.body.appendChild(statusDiv);
    return statusDiv;
  }

  function createButton() {
    if (document.getElementById('sharmanhall-claude-exporter-button')) return;

    const button = document.createElement('button');
    button.id = 'sharmanhall-claude-exporter-button';
    button.type = 'button';
    button.textContent = 'Export Claude Chat';
    button.style.cssText = [
      'position: fixed',
      'bottom: 18px',
      'right: 18px',
      'z-index: 2147483647',
      'padding: 12px 16px',
      'border: none',
      'border-radius: 999px',
      'background: #111827',
      'color: #fff',
      'font-size: 13px',
      'font-weight: 600',
      'cursor: pointer',
      'box-shadow: 0 10px 25px rgba(0,0,0,.25)',
    ].join(';');

    button.addEventListener('click', () => {
      void startExport();
    });

    document.body.appendChild(button);
  }

  async function getClipboardTextBestEffort() {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return null;
    }
  }

  function downloadMarkdown(content, filename) {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function fetchConversationData() {
    try {
      const conversationId = window.location.pathname.split('/').filter(Boolean).pop();
      const orgId = document.cookie.match(/lastActiveOrg=([^;]+)/)?.[1];

      if (!conversationId || !orgId) return null;

      const url = `/api/organizations/${orgId}/chat_conversations/${conversationId}?tree=true&rendering_mode=messages&render_all_tools=true`;
      const response = await fetch(url, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      console.warn('[Claude Exporter] Failed to fetch conversation data:', error);
      return null;
    }
  }

  function getMessageTimestampMap(data) {
    const map = new Map();
    if (!data?.chat_messages) return map;

    for (const msg of data.chat_messages) {
      const text = Array.isArray(msg.content)
        ? msg.content.map((part) => part?.text ?? '').join('').trim()
        : '';

      if (!text) continue;

      if (!map.has(text)) {
        map.set(text, {
          sender: msg.sender,
          createdAt: formatTimestamp(msg.created_at),
        });
      }
    }

    return map;
  }

  function getConversationTitle() {
    const apiTitle = STATE.conversationData?.name?.trim();
    if (apiTitle && apiTitle.toLowerCase() !== 'new conversation') {
      return sanitizeFilename(apiTitle);
    }

    const titleElement = document.querySelector(SELECTORS.conversationTitle);
    const title = titleElement?.textContent?.trim();

    if (!title || title === 'Claude' || /new conversation/i.test(title)) {
      return 'claude_conversation';
    }

    return sanitizeFilename(title);
  }

  function getOrderedMessageGroups() {
    const groups = Array.from(document.querySelectorAll(SELECTORS.messageActionsGroup));
    return groups
      .map((group, index) => {
        const hasFeedback = !!group.querySelector(SELECTORS.feedbackButton);
        const copyBtn = group.querySelector(SELECTORS.copyButton);
        return {
          index,
          type: hasFeedback ? 'claude' : 'human',
          group,
          copyBtn,
        };
      })
      .filter((item) => item.copyBtn);
  }

  function installClipboardInterceptor() {
    interceptedClipboardWrites = [];
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      throw new Error('Clipboard API is not available on this page.');
    }

    originalClipboardWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);

    navigator.clipboard.writeText = async function (text) {
      if (typeof text === 'string' && text.trim()) {
        interceptedClipboardWrites.push(text);
      }
      return Promise.resolve();
    };
  }

  function restoreClipboardInterceptor() {
    if (originalClipboardWriteText) {
      navigator.clipboard.writeText = originalClipboardWriteText;
    }
  }

  async function triggerCopyButtonsInOrder(items, statusDiv) {
    const ordered = [];

    for (let i = 0; i < items.length; i += 1) {
      const beforeCount = interceptedClipboardWrites.length;
      const item = items[i];

      statusDiv.textContent = `Exporting ${i + 1}/${items.length} (${item.type})...`;

      item.copyBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
      item.copyBtn.click();

      let waited = 0;
      const maxWait = 1800;
      const step = 60;

      while (interceptedClipboardWrites.length <= beforeCount && waited < maxWait) {
        await delay(step);
        waited += step;
      }

      const captured = interceptedClipboardWrites[interceptedClipboardWrites.length - 1];
      if (captured) {
        ordered.push({
          type: item.type,
          content: captured,
          order: item.index,
        });
      }

      await delay(DELAYS.copy);
    }

    return ordered;
  }

  function buildMarkdown(messages, timestampMap) {
    let output = '# Conversation with Claude\n\n';

    for (const msg of messages) {
      const matched = timestampMap.get(msg.content.trim());
      const sender = msg.type === 'human' ? 'Human' : 'Claude';
      const ts = matched?.createdAt;
      const header = ts ? `## ${sender} (${ts})` : `## ${sender}`;

      output += `${header}\n\n${msg.content}\n\n---\n\n`;
    }

    return output.trim() + '\n';
  }

  async function restoreClipboardBestEffort() {
    try {
      if (STATE.originalClipboardText && typeof GM_setClipboard === 'function') {
        GM_setClipboard(STATE.originalClipboardText, 'text');
        return;
      }
      if (STATE.originalClipboardText && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(STATE.originalClipboardText);
      }
    } catch {}
  }

  async function startExport() {
    if (STATE.isExporting) {
      notify('An export is already running.');
      return;
    }

    STATE.isExporting = true;
    const statusDiv = createStatus();

    try {
      statusDiv.textContent = 'Preparing export...';
      STATE.originalClipboardText = await getClipboardTextBestEffort();
      STATE.conversationData = await fetchConversationData();

      const timestampMap = getMessageTimestampMap(STATE.conversationData);
      const items = getOrderedMessageGroups();

      if (!items.length) {
        throw new Error('No Claude copy buttons were found on this page.');
      }

      installClipboardInterceptor();
      const orderedMessages = await triggerCopyButtonsInOrder(items, statusDiv);
      restoreClipboardInterceptor();

      if (!orderedMessages.length) {
        throw new Error('No messages were captured.');
      }

      const markdown = buildMarkdown(orderedMessages, timestampMap);
      const filename = `${getConversationTitle()}.md`;

      downloadMarkdown(markdown, filename);
      statusDiv.style.background = '#15803d';
      statusDiv.textContent = `Done. Downloaded ${filename}`;
      notify(`Downloaded ${filename}`);
      await restoreClipboardBestEffort();
    } catch (error) {
      restoreClipboardInterceptor();
      statusDiv.style.background = '#b91c1c';
      statusDiv.textContent = `Export failed: ${error.message}`;
      console.error('[Claude Exporter]', error);
      notify(`Export failed: ${error.message}`);
    } finally {
      STATE.isExporting = false;
      setTimeout(() => {
        statusDiv.remove();
      }, 3500);
    }
  }

  function init() {
    createButton();

    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand('Export Claude Chat', () => {
        void startExport();
      });
    }
  }

  setTimeout(init, DELAYS.startup);
})();