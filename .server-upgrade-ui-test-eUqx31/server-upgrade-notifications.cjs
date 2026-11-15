"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/workspace/serverUpgradeNotifications.ts
var serverUpgradeNotifications_exports = {};
__export(serverUpgradeNotifications_exports, {
  SERVER_UPGRADE_NOTIFICATION_SOURCE: () => SERVER_UPGRADE_NOTIFICATION_SOURCE,
  serverUpgradeNotificationItem: () => serverUpgradeNotificationItem,
  withServerUpgradeNotifications: () => withServerUpgradeNotifications
});
module.exports = __toCommonJS(serverUpgradeNotifications_exports);
var SERVER_UPGRADE_NOTIFICATION_SOURCE = "Server upgrade";
function serverUpgradeNotificationItem(notice) {
  return {
    color: "",
    emoji: "",
    isAgentStatus: false,
    notificationId: notice.id,
    panelId: "",
    projectEmoji: "",
    projectId: "",
    projectTitle: "",
    sessionId: "",
    sent: { body: notice.text },
    serverUpgrade: notice,
    since: notice.raisedAt,
    // A failure is something to act on; a success is finished news.
    state: notice.tone === "failure" ? "attention" : "unviewed",
    title: SERVER_UPGRADE_NOTIFICATION_SOURCE
  };
}
function withServerUpgradeNotifications(overview, notices) {
  if (notices.length === 0) return overview;
  const upgrades = [...notices].sort((a, b) => b.raisedAt - a.raisedAt).map(serverUpgradeNotificationItem);
  const notifications = [...upgrades, ...overview.notifications];
  return {
    ...overview,
    items: [...upgrades, ...overview.items],
    notifications,
    notificationCount: notifications.length
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SERVER_UPGRADE_NOTIFICATION_SOURCE,
  serverUpgradeNotificationItem,
  withServerUpgradeNotifications
});
