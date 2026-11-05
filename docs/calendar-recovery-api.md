# 外部日历未知结果人工核对 API

当前提供 API，尚未接入人工恢复 UI。接口要求登录并运行在共享存储 snapshot 模式；操作范围固定为登录用户的当前活动邮箱，不接受请求体或查询参数选择其他邮箱。`X-Mailbox-Id` 如与当前邮箱不一致会由现有邮箱校验拒绝。

## 获取可核对摘要

`GET /api/calendar-sync/unknown`

使用现有 `Authorization` 登录凭据，返回：

```json
{
  "mailboxId": "current-mailbox-id",
  "intents": [{
    "id": "intent-id",
    "status": "unknown",
    "target": { "connectionId": "connection-id", "status": "unknown" },
    "event": { "id": "event-id", "title": "面试", "status": "active" },
    "canReconcile": true
  }]
}
```

每项对应一个 unknown 回执目标，同一意图可能有多项。仅 `canReconcile: true` 的目标可进入核对；`sending` 须先由带租约 fencing 的 Worker 归一化，不通过此 API 强制恢复。本地日程已删除时 `event.status` 为 `deleted`，标题取意图保存的标题。摘要不返回连接凭据、原始事件正文或回执 payload。

## 提交人工核对

`POST /api/calendar-sync/unknown/:intentId/reconcile`

找到远端事件后，先核对其业务归属，再提交：

```json
{
  "confirmed": true,
  "connectionId": "connection-id",
  "outcome": "found",
  "remoteId": "verified-remote-event-id",
  "note": "已核对远端事件的标题、时间及所属日历。"
}
```

`found` 会调用 provider GET 验证远端 ID，用户仍须核对是否为这条业务日程。确认远端不存在时，使用 `outcome: "absent"`，不传 `remoteId`；`note` 必须填写实际核验说明。两种结果都要求 `confirmed: true`，说明非空且不超过 2000 字符。

成功提交后返回 HTTP 200：

```json
{
  "id": "intent-id",
  "status": "reconciled",
  "target": { "connectionId": "connection-id", "status": "verified" }
}
```

`absent` 的目标状态为 `manual_absent`，并保留屏障阻止后续意图自动创建；此接口不会重新发送、重置或创建任务。其他连接仍有未决回执时，意图状态可能仍为 `unknown`。成功响应等待 snapshot 提交；并发 CAS 冲突或提交失败不会返回成功。

未登录返回 401，当前邮箱不归属用户返回 403，非 unknown 或已变化的目标返回 409，输入错误返回 400；共享存储不可用、远端验证失败或提交失败返回 503。错误响应不包含原始 provider 错误、连接 token 或远端 payload。失败后重新获取摘要并核对输入。
