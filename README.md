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

- 路口走廊协调与基于车速的绿波 offset 计算
- 公交、应急车辆优先请求及乘客量/请求类型决策
- 行人过街、无障碍和最小安全过街时间校验
- 仿真后的 CO2、NOx、怠速小时估算
- 疏散场景、封闭路口和上游拥堵外溢推演

扩展接口：`/api/corridors`、`/api/priority-requests`、`/api/pedestrian-phase`、`/api/evacuation-scenarios`、`/api/simulations/:id/emissions`。

### 走廊绿波方案：计算 → 预览 → 发布

`POST /api/corridors/:id/coordinate` 已保留兼容，但不会再立即修改路口 offset，只会生成未发布方案。新流程使用：

1. `POST /api/corridors/:id/coordination/calculate`：按相邻路段距离、行驶方向和速度生成方案版本。
2. `GET /api/corridors/:id/coordination/:versionId/preview`：比较当前 offset 与候选 offset，不写入路网。
3. `POST /api/corridors/:id/coordination/:versionId/reject`：拒绝方案；拒绝后可调用 `/recalculate` 生成新版本。
4. `POST /api/corridors/:id/coordination/:versionId/publish`：发布方案，只有此时才原子写入路口 offset；旧发布版本自动标记为 `superseded`。

版本和审计接口：`GET /api/corridors/:id/coordination/versions`、`GET /api/corridors/:id/coordination/version/:versionRef`、`GET /api/corridors/:id/audit`。速度限定 10–70 km/h，距离必须为正数，方向角限定 `[0,360)`，行驶方向为 `FORWARD` 或 `REVERSE`；每个路口按各自周期计算回绕，`wrapCount` 表示跨周期次数。非法请求不会创建版本，也不会改变任何路口状态。
