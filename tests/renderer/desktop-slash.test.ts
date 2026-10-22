import { describe, expect, it, vi } from "vitest";
import { SLASH_COMMANDS as cliCommands } from "../../src/cli/commands";
import { SLASH_COMMANDS, parseSlashCommand } from "../../src/shared/slash-commands";
import { executeDesktopSlash, desktopSlashLimitation, type DesktopSlashHost } from "../../src/renderer/components/workbench/desktop-slash";
import type { ForgeBridge } from "../../src/shared/ipc";
import { parseSessionId } from "../../src/shared/schemas";
import { reviewSession } from "../fixtures/review-session";
const id = parseSessionId("11111111-1111-4111-8111-111111111111");
function fixture() {
  const bridge = {
    listSessions: vi.fn(async () => [{id,title:"test"}]),
    getSession: vi.fn(async () => ({ id, plan: null })),
    createSession: vi.fn(async () => ({id})),
    forkSession: vi.fn(async () => ({id})),
    renameSession: vi.fn(async () => ({id})),
    archiveSession: vi.fn(async () => ({id})),
    compactSession: vi.fn(async () => ({id})),
    getDiagnostics: vi.fn(async () => ({messageCount:3})),
    getProjectContext: vi.fn(async () => ({skills:[{id:'skill'}]})),
    listCheckpoints: vi.fn(async () => []),
    getCheckpointDiff: vi.fn(async () => 'diff'),
    restoreCheckpoint: vi.fn(async () => ({id})),
    listMcpServers: vi.fn(async () => []),
    registerMcpServer: vi.fn(async () => ({})),
    setMcpEnabled: vi.fn(async () => {}),
    removeMcpServer: vi.fn(async () => {}),
    getMcpHealth: vi.fn(async () => ({})),
  };
  const host: DesktopSlashHost = { bridge: bridge as unknown as ForgeBridge, sessionId:id,workspace:'/tmp',model:'test/model',mode:'build',permission:'workspace',running:false,
    review:vi.fn(async()=>true),setModel:vi.fn(),setMode:vi.fn(),setPermission:vi.fn(async()=>{}),setReasoning:vi.fn(async()=>true),openModel:vi.fn(),applySnapshot:vi.fn(async()=>{}) };
  return {host,bridge};
}
describe('shared slash semantics', () => {
  it('has exactly one catalog and CLI whitespace argument parsing', () => {
    expect(cliCommands).toBe(SLASH_COMMANDS);
    expect(parseSlashCommand('/rename  a   b')).toEqual({command:'/rename',words:['a','b'],value:'a b'});
    expect(SLASH_COMMANDS.some(c => ['/settings','/stop'].includes(c.name))).toBe(false);
  });
  it('dispatches session/resource actions with CLI arguments', async () => {
    const {host,bridge} = fixture();
    for (const line of ['/new','/resume','/sessions',`/resume ${id}`,'/fork 2','/rename a b','/archive','/compact','/plan','/diagnostics','/context','/skills','/export','/checkpoints','/checkpoints diff cp','/checkpoints restore cp','/mcp list','/mcp register server label node --version','/mcp enable server','/mcp disable server','/mcp remove server','/mcp health server']) await executeDesktopSlash(line,host);
    expect(bridge.createSession).toHaveBeenCalledWith({workspace:'/tmp',model:'test/model'});
    expect(bridge.forkSession).toHaveBeenCalledWith(id,2);
    expect(bridge.renameSession).toHaveBeenCalledWith(id,'a b');
    expect(bridge.archiveSession).toHaveBeenCalledWith(id,true);
    expect(bridge.restoreCheckpoint).toHaveBeenCalledWith(id,'cp');
    expect(bridge.registerMcpServer).toHaveBeenCalledWith({id:'server',label:'label',command:'node',args:['--version']});
    expect(bridge.setMcpEnabled).toHaveBeenCalledWith('server',false);
  });
  it('validates arguments, reports bridge limitations, never substitutes another action', async () => {
    const {host,bridge} = fixture();
    for (const command of SLASH_COMMANDS.filter(c => desktopSlashLimitation(c.name))) await expect(executeDesktopSlash(command.name,host)).rejects.toThrow(desktopSlashLimitation(command.name));
    for (const line of ['/mode bogus','/permission bogus','/reasoning bogus','/resume short','/checkpoints restore','/mcp bogus','/settings','/stop']) await expect(executeDesktopSlash(line,host)).rejects.toThrow();
    expect(host.setPermission).not.toHaveBeenCalled();
    expect(bridge.restoreCheckpoint).not.toHaveBeenCalled();
    await expect(executeDesktopSlash('/compact',{...host,running:true})).rejects.toThrow('正在运行');
    expect(bridge.compactSession).not.toHaveBeenCalled();
    await expect(executeDesktopSlash('/rename title',{...host,sessionId:undefined})).rejects.toThrow('No active session');
  });
  it('reports compact sizes, fallback and unchanged history instead of only a session ID', async () => {
    const {host,bridge} = fixture();
    const summary = { content: 'memory', boundary: 3, fallback: false };
    const snapshot = { id, contextSummary: summary, events: [{ type: 'context_compacted', beforeChars: 50000, afterChars: 1500 }] };
    bridge.compactSession.mockResolvedValue(snapshot);
    const success = await executeDesktopSlash('/compact', host);
    expect(success.text).toContain('压缩完成');
    expect(success.text).toContain('50000 → 1500');
    expect(success.text).toContain('原始聊天记录保留');
    expect(host.applySnapshot).toHaveBeenCalledWith(snapshot, false);
    const fallbackSnapshot = { ...snapshot, contextSummary: { ...summary, fallback: true } };
    bridge.compactSession.mockResolvedValue(fallbackSnapshot);
    expect((await executeDesktopSlash('/compact', host)).text).toContain('降级摘要');
    bridge.getSession.mockResolvedValue({ ...snapshot, plan: null });
    expect((await executeDesktopSlash('/compact', host)).text).toContain('没有新增可压缩内容');
    bridge.compactSession.mockRejectedValueOnce(new Error('provider unavailable'));
    await expect(executeDesktopSlash('/compact', host)).rejects.toThrow('provider unavailable');
  });
  it('acknowledges queue and steering actions without persistent text, but keeps errors', async () => {
    const {host} = fixture();
    const queueCommand = vi.fn();
    const steer = vi.fn(async () => true);
    const runningHost = {...host, running:true, queueCommand, steer};
    for (const value of ['', 'add follow up', 'run', 'clear']) {
      expect(await executeDesktopSlash(`/queue ${value}`, runningHost)).toEqual({clearPrompt:true});
      expect(queueCommand).toHaveBeenLastCalledWith(value);
    }
    expect(await executeDesktopSlash('/steer change direction', runningHost)).toEqual({clearPrompt:true});
    expect(steer).toHaveBeenCalledWith('change direction');
    steer.mockResolvedValueOnce(false);
    await expect(executeDesktopSlash('/steer retry', runningHost)).rejects.toThrow('草稿已保留');
    queueCommand.mockImplementationOnce(() => { throw new Error('加入待发队列失败'); });
    await expect(executeDesktopSlash('/queue add retry', runningHost)).rejects.toThrow('加入待发队列失败');
  });
  it('starts a readonly review from the full session and preserves settings and failed drafts', async () => {
    const {host} = fixture();
    const snapshot = reviewSession({ id });
    const getSession = vi.fn(async () => snapshot);
    const review = vi.fn<DesktopSlashHost['review']>(async () => true);
    const reviewHost = { ...host, review, bridge: { ...host.bridge, getSession } };
    expect(await executeDesktopSlash('/review 检查边界', reviewHost)).toEqual({ clearPrompt: true });
    expect(getSession).toHaveBeenCalledWith(id);
    expect(review).toHaveBeenCalledWith(expect.objectContaining({ sessionId: id, permission: 'readonly', mode: 'build', prompt: expect.stringContaining('检查边界') }));
    expect(review.mock.calls[0]?.[0].prompt).toContain('src/example.ts');
    expect(host.setModel).not.toHaveBeenCalled();
    expect(host.setMode).not.toHaveBeenCalled();
    expect(host.setPermission).not.toHaveBeenCalled();
    review.mockResolvedValueOnce(false);
    await expect(executeDesktopSlash('/review', reviewHost)).rejects.toThrow('草稿已保留');
    await expect(executeDesktopSlash('/review', { ...reviewHost, running: true })).rejects.toThrow('正在运行');
    await expect(executeDesktopSlash('/review', { ...reviewHost, sessionId: undefined })).rejects.toThrow('No active session');
    expect(review).toHaveBeenCalledTimes(2);
  });
  it('keeps no-argument mode/permission informational and accepts explicit values', async () => {
    const {host} = fixture();
    expect(await executeDesktopSlash('/mode',host)).toEqual({text:'Mode: build'});
    expect(await executeDesktopSlash('/permission',host)).toEqual({text:'Permission: workspace'});
    expect(host.setPermission).not.toHaveBeenCalled();
    await executeDesktopSlash('/model provider/id',host);
    await executeDesktopSlash('/mode plan',host);
    await executeDesktopSlash('/permission readonly',host);
    await executeDesktopSlash('/reasoning high',host);
    expect(host.setModel).toHaveBeenCalledWith('provider/id');
    expect(host.setMode).toHaveBeenCalledWith('plan');
    expect(host.setPermission).toHaveBeenCalledWith('readonly');
    expect(host.setReasoning).toHaveBeenCalledWith('high');
  });
});
