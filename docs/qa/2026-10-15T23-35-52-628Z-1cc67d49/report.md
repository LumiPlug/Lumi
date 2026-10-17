# Lumi APP功能测试

发现功能失败 · 2026年10月16日 09:35:46（北京时间）

{"PASS":122,"FAIL":6,"BLOCKED":4,"NOT_RUN":0}

| 用例 | 维度 | 状态 | 实际 |
| --- | --- | --- | --- |
| APP-04 窄窗口与键盘 | ui | FAIL | 已在720×560逻辑像素原生窗口实测设置布局、提示词弹窗、Tab焦点可达和Escape关闭，并恢复1120×820。保存/授权等部分确认弹窗仍间歇出现视觉存在但完整AX仅HTML根、标题及按钮缺失；真实键盘Tab→Return可继续，辅助技术可读性不通过。 |
| APP-05 顶部反馈与重复提交 | ui | FAIL | 成功/失败/字段校验顶部反馈和首错聚焦正确；实测成功复制提示4591ms后消失，错误4383ms仍在、8710ms后消失。快速双击开始运行连续两次均先创建单个任务，再误点原位停止按钮立即取消，显示远端结果未知，忙态重复点击保护不完整。 |
| APP-08 隐藏最小化与5分钟释放 | ui | BLOCKED | 失焦/关闭/最小化期间MCP服务继续可用，恢复能同步；未保存编辑隐藏恢复保留。最终仅原生关闭且325134ms不触碰QA窗口后重开，iframe标识与临时SDK结果仍在，未观察到五分钟销毁重建。未独立取得隐藏状态/销毁事件，故不判通过，并保留待查疑点。 |
| CON-06 并发与请求ID | stdio | FAIL | 重复两次复现：两个独立stdio代理客户端都使用tools/call id=1，同时运行qapool1.slow和qapool2.slow；取消peer0后，未被取消的peer1也收到isError，两个独立任务均cancelled。HTTP同ID并发对照不误伤。 |
| CON-08 仅MCP令牌越权负向 | http | FAIL | 仅MCP会话令牌即可调用宿主管理接口：save/enable/run及capabilities enable返回200，绕过原生审阅；仅对本轮printf工具复现，已disable还原。 |
| RUN-03 历史记录详情复制 | ui | FAIL | 成功/失败/取消的历史状态、事件和结果可重载，复制MCP结构化结果与显示一致，原始数据显示受限结果；但AI发起的历史MCP任务打开运行详情明确提示“没有保留当时的输入，无法查看”，输入快照验收不通过。 |
| SK-01 本机发现分类搜索与排序 | ui | BLOCKED | 多源共享物理技能归并为一条，详情列出Codex/Qoder/Gemini；同名异目录及两托管副本独立共4条，分类和搜索无结果已实测。创建日期回退及排序的特殊时间戳尚未注入验证。 |
| HOME-09 iframe权限与离开主页 | ui | BLOCKED | 已实测原生iframe拒绝主页管理/Skills管理和未授权工具，离开主页期间SDK返回home_inactive，返回后恢复。旧版本frame被替换可见，但尚无独立旧frame持续调用的有效观测证据。 |
| KB-14 原生导入导出 | ui | FAIL | 两次原生导出均立即提示知识库已导出，但无保存面板、Downloads/隔离HOME/项目树未找到文件，未能完成导出后重导入闭环。独立合法公开格式fixture原生导入v1成功；非法JSON和51MiB包被拒绝且旧版保留。 |
| KB-16 重启续建及并发状态 | journey | BLOCKED | writing阶段真实APP正常重启后seq1保留并续建发布；900文档/101批次构建在SQLite只读核对validating的瞬间终止QA Core，重启恢复writing、清除旧validationId且保留全部批次，再校验并发发布仅生成v1。Worker完成与MCP取消竞态保持cancelled。归档/接管与Worker完成的精确并发窗口尚未强制复现，故整项不计通过。 |

功能缺口：AI通过MCP安装Skills、Memory

清理：{"status":"PASS","actual":"QA APP已正常退出；SDK客户端和3个夹具服务已关闭，残留QA代理已终止；测试端口48592–48597均释放。原用户Lumi进程11475/11482仍运行。隔离主测试数据已恢复，测试对象/夹具/证据保留供复现，临时剪贴板文档不保存。产品源码保持本轮开始状态。","evidence":[{"path":"evidence/cleanup-verification.json","kind":"cleanup","sha256":"9280da60d819f647dc3a8caec0830940a415bd51610a62cb5c11fa5777f0b55f"},{"path":"evidence/public-evidence-secret-audit-final.json","kind":"fixture","sha256":"1f3c9bde9241602407ba885eccdf399e10e37aa94b87aafdcb7f09b93333e7b7"},{"path":"evidence/precleanup-identity.json","kind":"fixture","sha256":"14acdeb422557019847976650259d2973e59d439f6174e64a97a28f097f583f6"}]}
