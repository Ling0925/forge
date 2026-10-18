import { PencilSimple } from "@phosphor-icons/react";
import { type MouseEvent, useId, useState } from "react";
import {
  CONNECTION_SETTINGS_PATH,
  connectionDisplayTarget,
} from "../../state/mobile-connection";
import { Button } from "../primitives/Button";
import { Field } from "../primitives/Field";
import { Input } from "../primitives/Input";
import "./server-connection.css";

export interface ServerConnectionProps {
  /**
   * The settings page holds unsaved edits. The first tap then only opens an
   * in-page confirmation; the navigation itself is left to a second, explicit
   * tap on the same plain link, so no click is ever synthesized.
   */
  readonly dirty?: boolean | undefined;
  /**
   * Native-entry hook. It receives the real anchor event, so the owner can
   * observe it and call `preventDefault()` before the page navigates.
   */
  readonly onNavigate?:
    | ((event: MouseEvent<HTMLAnchorElement>) => void)
    | undefined;
}

/**
 * Connection panel for the Android workbench shell.
 *
 * The page shows only the current origin, read-only, and offers one plain
 * same-origin link to the locally edited connection page. It never navigates,
 * fetches or posts on its own: the Android shell intercepts that link when the
 * user taps it, and nothing here talks to a native bridge.
 */
export function ServerConnection({
  dirty = false,
  onNavigate,
}: ServerConnectionProps = {}) {
  // Read once: the address of the page the shell already loaded.
  const [target] = useState(() => connectionDisplayTarget());
  const [confirming, setConfirming] = useState(false);
  const fieldId = useId();

  const requestEdit = (event: MouseEvent<HTMLAnchorElement>) => {
    onNavigate?.(event);
    if (event.defaultPrevented || !dirty) return;
    // A dirty draft must never be dropped by an accidental tap.
    event.preventDefault();
    setConfirming(true);
  };

  return (
    <div className="server-connection">
      <p className="server-connection-lead">
        管理这台手机连接的 Forge 服务器。
      </p>

      <Field
        id={fieldId}
        label="当前服务器"
        helper="只读；仅显示协议、主机与端口，不含路径、查询或凭据。"
      >
        <Input
          id={fieldId}
          isMono
          readOnly
          value={target}
          aria-label="当前服务器地址"
          onFocus={(event) => event.currentTarget.select()}
        />
      </Field>
      {!target && (
        <p className="server-connection-unknown">
          无法读取当前地址；仍可用下面的入口打开本机编辑页查看已保存的连接。
        </p>
      )}

      <ul className="server-connection-points">
        <li>编辑页会预填当前地址，也可以改用扫码或最近连接来切换服务器。</li>
        <li>切换不会取消原服务器上的任务；取消编辑会保留当前工作台。</li>
      </ul>

      {confirming ? (
        <div className="server-connection-confirm">
          <p role="alert">
            设置里还有未保存的修改。切换服务器后这些修改不会保留，是否继续？
          </p>
          <div className="server-connection-actions">
            {/* Still a real user tap on a real link: the shell keeps the
                gesture, origin and path checks it needs. */}
            <a
              className="btn btn-secondary btn-sm server-connection-edit"
              href={CONNECTION_SETTINGS_PATH}
            >
              继续打开连接编辑页
            </a>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirming(false)}
            >
              取消，留在设置页
            </Button>
          </div>
        </div>
      ) : (
        <div className="server-connection-actions">
          <a
            className="btn btn-secondary btn-sm server-connection-edit"
            href={CONNECTION_SETTINGS_PATH}
            onClick={requestEdit}
          >
            <span aria-hidden="true" className="server-connection-edit-icon">
              <PencilSimple size={14} />
            </span>
            编辑或更换连接
          </a>
        </div>
      )}
    </div>
  );
}
