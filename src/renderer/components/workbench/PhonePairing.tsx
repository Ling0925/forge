import { CopySimple, QrCode, WarningCircle } from "@phosphor-icons/react";
import * as QRCode from "qrcode";
import { useEffect, useId, useRef, useState } from "react";
import { type LanStatus, lanRequestSchema } from "../../../shared/lan";
import { OperationScope } from "../../state/operation-scope";
import { useWorkbench } from "../../state/workbench-context";
import { Button } from "../primitives/Button";
import { Field } from "../primitives/Field";
import { Input } from "../primitives/Input";
import { Select } from "../primitives/Select";
import "./phone-pairing.css";

const DEFAULT_PORT = 41234;

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Android LAN pairing settings panel.
 *
 * Nothing is started implicitly: the initial `status()` read only reports what
 * the host already does, and publishing requires an explicit "开始公开" click.
 * A failed operation is reported once and never replayed; the user must ask for
 * the status again before deciding what to do.
 */
export function PhonePairing() {
  const { state, chooseWorkspace } = useWorkbench();
  const headingId = useId();
  const defaultWorkspace =
    state.activeSnapshot?.workspace ?? state.sessions?.[0]?.workspace ?? "";
  const [status, setStatus] = useState<LanStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [host, setHost] = useState("");
  const [port, setPort] = useState(String(DEFAULT_PORT));
  const [workspace, setWorkspace] = useState(defaultWorkspace);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [qr, setQr] = useState("");
  const [qrError, setQrError] = useState("");
  const alive = useRef(true);
  const busyRef = useRef(false);
  const scope = useRef(new OperationScope());
  const urlRef = useRef<HTMLInputElement>(null);

  const bridge = typeof window === "undefined" ? undefined : window.forgeLan;
  const canControl = bridge?.canControl === true;
  const url = status?.url ?? null;
  const addresses = status?.addresses ?? [];

  useEffect(() => {
    alive.current = true;
    scope.current = new OperationScope();
    const current = window.forgeLan;
    if (!current) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void current
      .status()
      .then((next) => {
        if (cancelled || !alive.current) return;
        setStatus(next);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled || !alive.current) return;
        setError(message(err, "读取局域网状态失败。"));
        setLoading(false);
      });
    return () => {
      cancelled = true;
      alive.current = false;
      scope.current.close();
    };
  }, []);

  // Follow the session workspace until the user edits the field themselves.
  const workspaceTouched = useRef(false);
  useEffect(() => {
    if (!workspaceTouched.current) setWorkspace(defaultWorkspace);
  }, [defaultWorkspace]);

  useEffect(() => {
    const first = status?.addresses[0];
    if (first) setHost((current) => current || first);
  }, [status]);

  useEffect(() => {
    const target = status?.url ?? null;
    setQr("");
    setQrError("");
    if (!target) return;
    let cancelled = false;
    void QRCode.toDataURL(target, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 240,
      color: { dark: "#12100e", light: "#ffffff" },
    })
      .then((value) => {
        if (!cancelled) setQr(value);
      })
      .catch(() => {
        if (!cancelled) setQrError("二维码生成失败；可以改用下方地址手动配对。");
      });
    return () => {
      cancelled = true;
    };
  }, [status?.url]);

  const run = async (operation: (current: NonNullable<typeof bridge>) => Promise<LanStatus>) => {
    const current = window.forgeLan;
    if (!current) {
      setError("当前环境不支持局域网配对控制。");
      return;
    }
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const valid = scope.current.begin();
    try {
      const next = await operation(current);
      if (!valid() || !alive.current) return;
      setStatus(next);
    } catch (err) {
      if (!valid() || !alive.current) return;
      // Never replay an uncertain LAN effect: the user must re-read status.
      setError(`${message(err, "局域网操作失败。")} 请刷新状态确认后再决定是否重试。`);
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  };

  const start = () => {
    const parsed = lanRequestSchema.safeParse({
      action: "start",
      host,
      port: Number(port),
      workspace: workspace.trim(),
    });
    if (!parsed.success) {
      setNotice("");
      setError(
        !host
          ? "请选择一个局域网 IPv4 地址。"
          : !workspace.trim()
            ? "请选择或输入服务器工作区目录。"
            : "端口需为 1024–65535 之间的整数。",
      );
      return;
    }
    const request = parsed.data;
    if (request.action !== "start") return;
    void run((current) => current.start({
      host: request.host,
      port: request.port,
      workspace: request.workspace,
    }));
  };

  const pickWorkspace = async () => {
    if (busyRef.current) return;
    setError("");
    setNotice("");
    try {
      const picked = await chooseWorkspace();
      if (!alive.current) return;
      if (picked) {
        // An explicit choice wins over later session switches.
        workspaceTouched.current = true;
        setWorkspace(picked);
      } else setNotice("未选择工作区，已保留原来的目录。");
    } catch (err) {
      if (alive.current) setError(message(err, "选择工作区失败。"));
    }
  };

  const copy = async () => {
    if (!url) return;
    setNotice("");
    try {
      const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
      if (!clipboard?.writeText) throw new Error("clipboard unavailable");
      await clipboard.writeText(url);
      if (alive.current) setNotice("配对地址已复制。");
    } catch {
      if (!alive.current) return;
      // HTTP pages may not expose the async clipboard; fall back to selection.
      const field = urlRef.current;
      field?.focus();
      field?.select();
      setNotice("当前环境无法直接写入剪贴板，已选中地址，请手动复制。");
    }
  };

  return (
    <div className="phone-pairing">
      <div className="phone-pairing-head">
        <div className="phone-pairing-head-text">
          <h3 id={headingId}>
            <QrCode size={16} weight="bold" aria-hidden="true" /> Android 局域网连接
          </h3>
          <p>
            在局域网内公开当前核心的 HTTP 地址，让 Android 应用扫码连接同一个核心与任务。
          </p>
        </div>
        <span className={`phone-pairing-badge ${url ? "is-live" : "is-idle"}`}>
          {loading ? "读取中" : url ? "公开中" : "未公开"}
        </span>
      </div>

      <ul className="phone-pairing-notes">
        <li>二维码包含连接地址，扫码或输入地址即可连接；HTTP 不提供传输保密性。</li>
        <li>个人局域网直接接入，无需邀请码、设备授权或回到电脑前确认；网络可达范围由你管理。</li>
        <li>{canControl
          ? "手机连接的是同一核心与同一份任务列表；关闭桌面应用会终止正在运行的任务。"
          : "手机连接当前服务器的核心与任务；停止该核心服务会终止正在运行的任务。"}</li>
        <li>停止公开只会断开远程连接，不会取消已经在运行的任务。</li>
      </ul>

      {error && (
        <p role="alert" className="phone-pairing-error">
          <WarningCircle size={15} weight="bold" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
      {notice && !error && (
        <p role="status" className="phone-pairing-notice">
          {notice}
        </p>
      )}

      {!bridge && (
        <p className="phone-pairing-hint">
          当前宿主没有提供局域网配对桥，无法在这里显示或控制配对地址。
        </p>
      )}

      {bridge && canControl && !url && (
        <div className="phone-pairing-form" aria-labelledby={headingId}>
          <Field
            id="pairing-host"
            label="LAN 地址"
            helper={
              addresses.length
                ? "只列出本机非回环的具体 IPv4 地址。"
                : "未检测到可用的局域网 IPv4 地址；接入局域网后刷新状态。"
            }
          >
            <Select
              id="pairing-host"
              value={host}
              onChange={(event) => setHost(event.target.value)}
              placeholder="选择可用的 IPv4 地址"
              options={addresses.map((value) => ({ value, label: value }))}
              disabled={busy || !addresses.length}
            />
          </Field>
          <Field id="pairing-port" label="端口" helper="1024–65535，且未被其它程序占用。">
            <Input
              id="pairing-port"
              inputMode="numeric"
              value={port}
              onChange={(event) => setPort(event.target.value)}
              disabled={busy}
            />
          </Field>
          <Field
            id="pairing-workspace"
            label="服务器工作区"
            helper="默认使用当前会话的工作区；也可以选择一个本机目录。"
          >
            <Input
              id="pairing-workspace"
              value={workspace}
              onChange={(event) => {
                workspaceTouched.current = true;
                setWorkspace(event.target.value);
              }}
              placeholder="/home/you/project"
              disabled={busy}
            />
          </Field>
          <div className="phone-pairing-actions">
            <Button size="sm" variant="secondary" onClick={() => void pickWorkspace()} disabled={busy}>
              选择工作区…
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void run((current) => current.status())}
              disabled={busy}
            >
              刷新状态
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={start}
              loading={busy}
              disabled={loading || !host || !addresses.length}
            >
              开始公开
            </Button>
          </div>
          <p className="phone-pairing-hint">
            点击“开始公开”才会开启 Forge 局域网入口；公开后可在局域网内直接访问该地址。
          </p>
        </div>
      )}

      {bridge && !canControl && (
        <p className="phone-pairing-hint">
          Web 版只显示当前服务器公开的配对地址，不能在这里启动或停止服务。
        </p>
      )}

      {url && (
        <div className="phone-pairing-live">
          <div className="phone-pairing-qr-wrap">
            {qr ? (
              <img className="phone-pairing-qr" src={qr} alt={`Android 扫码配对二维码：${url}`} />
            ) : (
              <div className="phone-pairing-qr is-placeholder" aria-hidden="true" />
            )}
          </div>
          <div className="phone-pairing-url">
            <label htmlFor="pairing-url">配对地址</label>
            <input
              id="pairing-url"
              ref={urlRef}
              className="phone-pairing-url-field"
              value={url}
              readOnly
              spellCheck={false}
              onFocus={(event) => event.currentTarget.select()}
            />
            <div className="phone-pairing-actions">
              <Button size="sm" variant="secondary" icon={<CopySimple size={14} />} onClick={() => void copy()}>
                复制地址
              </Button>
              {canControl && (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => void run((current) => current.stop())}
                  loading={busy}
                >
                  停止公开
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void run((current) => current.status())}
                disabled={busy}
              >
                刷新状态
              </Button>
            </div>
          </div>
        </div>
      )}
      {qrError && <p className="phone-pairing-hint">{qrError}</p>}
    </div>
  );
}
