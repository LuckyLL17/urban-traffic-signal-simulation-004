# 城市交通信号配时与拥堵传播仿真服务

纯后端 Node.js + TypeScript + Fastify 服务，默认无需 Docker、数据库或消息中间件即可运行。

## 启动

```bash
npm install
npm run dev
```

默认端口：`6302`。健康检查：`GET /health`。

## 业务闭环

- 领域状态模型与事件输入
- 可回放的时间序列/仿真流程
- 约束校验与风险门禁
- 方案版本、审计轨迹与异常处置
- 所有状态暂存于进程内，便于本机演示；可扩展为数据库、事件总线和实时流处理架构

## 增强业务闭环

- 路口走廊协调与基于车速的绿波 offset 计算（计算、预览、拒绝、发布，支持相邻路段距离/行驶方向/版本审计）
- 公交、应急车辆优先请求及乘客量/请求类型决策
- 行人过街、无障碍和最小安全过街时间校验
- 仿真后的 CO2、NOx、怠速小时估算
- 疏散场景、封闭路口和上游拥堵外溢推演

扩展接口：`/api/corridors`、`/api/priority-requests`、`/api/pedestrian-phase`、`/api/evacuation-scenarios`、`/api/simulations/:id/emissions`。

## 走廊协调：计算、预览、发布

`POST /api/corridors/:id/coordinate` 通过 `action` 区分阶段。计算和预览不会修改当前路网，只有发布成功才写入路口 `offset`。

```jsonc
// 1. calculate/recalculate：支持相邻路段实际距离和行驶方向
{
  "action": "calculate",
  "speedKph": 36,
  "direction": "forward",
  "distancesMeters": [900, 1100]
}
```

也可以用无向相邻路段 `links`，端点顺序可与走廊方向相反；`direction: "reverse"` 会按走廊顺序反向行驶：

```jsonc
{
  "action": "recalculate",
  "speedKph": 36,
  "direction": "reverse",
  "links": [
    { "fromId": "J-01", "toId": "J-02", "distanceMeters": 900 },
    { "fromId": "J-03", "toId": "J-02", "distanceMeters": 1100 }
  ]
}
```

后续动作：

```jsonc
{ "action": "preview", "planId": "<id>" }   // 只读预览当前 offset 与拟发布 offset
{ "action": "reject", "planId": "<id>", "reason": "..." }
{ "action": "publish", "planId": "<id>" }  // 必须先 preview；原子写入整个走廊
```

查询同一走廊的方案版本：`GET /api/corridors/:id/coordination-plans` 和 `GET /api/corridors/:id/coordination-plans/:planId`。计算、预览、拒绝和发布都会写入 `/api/audit`。

非法速度、距离、相邻顺序或重复路段会在校验阶段返回 `400/409`，不会创建方案，也不会留下部分 offset。预览或发布期间若周期或 offset 基线发生变化，请求会被拒绝并要求重新计算。行驶时间超过周期时按参考周期回绕，返回每个路口的 `wrapCount` 和总回绕次数。
