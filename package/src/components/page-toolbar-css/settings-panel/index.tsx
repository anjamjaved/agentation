import { memo, useLayoutEffect, useRef } from "react";
import { usePanelPresence } from "../../../hooks/use-panel-presence";
import { COLOR_OPTIONS, ToolbarSettings, type OutputDetailLevel } from "..";
import { OUTPUT_DETAIL_OPTIONS } from "../../../utils/generate-output";
import { HelpTooltip } from "../../help-tooltip";
import { IconChevronLeft, IconMoon, IconSun } from "../../icons";
import { Switch } from "../../switch";
import { CheckboxField } from "./checkbox-field";
import styles from "./styles.module.scss";

type ConnectionStatus = "disconnected" | "connecting" | "connected";

export type SettingsPanelProps = {
  settings: ToolbarSettings;
  outputDetail?: OutputDetailLevel;
  onSettingsChange: (patch: Partial<ToolbarSettings>) => void;

  isDarkMode: boolean;
  onToggleTheme: () => void;

  isDevMode: boolean;

  connectionStatus: ConnectionStatus;
  endpoint?: string;

  onExited: () => void;
  isOpen: boolean;

  /** Position override: show panel above toolbar when toolbar is near bottom */
  toolbarNearBottom: boolean;

  settingsPage: "main" | "automations";
  onSettingsPageChange: (page: "main" | "automations") => void;

  onHideToolbar: () => void;
};

export const SettingsPanel = memo(function SettingsPanel({
  settings,
  outputDetail,
  onSettingsChange,
  isDarkMode,
  onToggleTheme,
  isDevMode,
  connectionStatus,
  endpoint,
  onExited,
  isOpen,
  toolbarNearBottom,
  settingsPage,
  onSettingsPageChange,
  onHideToolbar,
}: SettingsPanelProps) {
  const { ref: panelRef } = usePanelPresence(isOpen, { keepMounted: true, onExited });
  const navRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const focusPageRef = useRef(false);
  useLayoutEffect(() => {
    if (!isOpen || !focusPageRef.current) return;
    focusPageRef.current = false;
    (settingsPage === "automations" ? backRef : navRef).current?.focus();
  }, [isOpen, settingsPage]);
  const themeToggleLabel = isDarkMode
    ? "Switch to light mode"
    : "Switch to dark mode";

  return (
    <div
      className={`${styles.settingsPanel} ${toolbarNearBottom ? styles.below : ""}`}
      style={
        toolbarNearBottom
          ? { bottom: "auto", top: "calc(100% + 0.5rem)" }
          : undefined
      }
      data-agentation-settings-panel
      ref={(node) => { panelRef.current = node; node?.toggleAttribute("inert", !isOpen); }}
      role="group"
      aria-label="Feedback settings"
      aria-hidden={!isOpen}
    >
      <div className={styles.settingsPanelContainer}>
        {/* ── Main page ── */}
        <div
          className={`${styles.settingsPage} ${settingsPage === "automations" ? styles.slideLeft : ""}`}
          ref={(node) => { node?.toggleAttribute("inert", settingsPage !== "main"); }}
          aria-hidden={settingsPage !== "main"}
        >
          <div className={styles.settingsHeader}>
            <a className={styles.settingsBrand} href="https://agentation.com" target="_blank" rel="noopener noreferrer" aria-label="Agentation">
              Agentation
            </a>
            <p className={styles.settingsVersion}>v{__VERSION__}</p>
            <button
              className={styles.themeToggle}
              onClick={onToggleTheme}
              title={themeToggleLabel}
              aria-label={themeToggleLabel}
            >
              <span className={styles.themeIconWrapper}>
                <span
                  key={isDarkMode ? "sun" : "moon"}
                  className={styles.themeIcon}
                >
                  {isDarkMode ? <IconSun size={20} /> : <IconMoon size={20} />}
                </span>
              </span>
            </button>
          </div>

          <div className={styles.divider}></div>

          {/* Output detail + React toggle */}
          <div className={styles.settingsSection}>
            <div className={styles.settingsRow}>
              <div className={styles.settingsLabel}>
                Output Detail
                <HelpTooltip content="Controls how much detail is included in the copied output" />
              </div>
              <button
                className={styles.cycleButton}
                disabled={outputDetail !== undefined}
                title={outputDetail !== undefined ? "Output detail is set by the application" : undefined}
                onClick={() => {
                  const currentIndex = OUTPUT_DETAIL_OPTIONS.findIndex(
                    (opt) => opt.value === settings.outputDetail,
                  );
                  const nextIndex =
                    (currentIndex + 1) % OUTPUT_DETAIL_OPTIONS.length;
                  onSettingsChange({
                    outputDetail: OUTPUT_DETAIL_OPTIONS[nextIndex].value,
                  });
                }}
              >
                <span
                  key={settings.outputDetail}
                  className={styles.cycleButtonText}
                >
                  {
                    OUTPUT_DETAIL_OPTIONS.find(
                      (opt) => opt.value === settings.outputDetail,
                    )?.label
                  }
                </span>
                <span className={styles.cycleDots}>
                  {OUTPUT_DETAIL_OPTIONS.map((option) => (
                    <span
                      key={option.value}
                      className={`${styles.cycleDot} ${settings.outputDetail === option.value ? styles.active : ""}`}
                    />
                  ))}
                </span>
              </button>
            </div>

            <div
              className={`${styles.settingsRow} ${styles.settingsRowMarginTop} ${!isDevMode ? styles.settingsRowDisabled : ""}`}
            >
              <div className={styles.settingsLabel}>
                React Components
                <HelpTooltip
                  content={
                    !isDevMode
                      ? "Disabled — production builds minify component names, making detection unreliable. Use in development mode."
                      : "Include React component names in annotations"
                  }
                />
              </div>
              <Switch
                aria-label="React Components"
                checked={isDevMode && settings.reactEnabled}
                onChange={(e) =>
                  onSettingsChange({ reactEnabled: e.target.checked })
                }
                disabled={!isDevMode}
              />
            </div>

            <div
              className={`${styles.settingsRow} ${styles.settingsRowMarginTop}`}
            >
              <div className={styles.settingsLabel}>
                Hide Until Restart
                <HelpTooltip content="Hides the toolbar until you open a new tab" />
              </div>
              <Switch
                aria-label="Hide Until Restart"
                checked={false}
                onChange={(e) => {
                  if (e.target.checked) onHideToolbar();
                }}
              />
            </div>
          </div>

          <div className={styles.divider}></div>

          {/* Color picker */}
          <div className={styles.settingsSection}>
            <div
              className={`${styles.settingsLabel} ${styles.settingsLabelMarker}`}
            >
              Marker Color
            </div>
            <div className={styles.colorOptions}>
              {COLOR_OPTIONS.map((color) => (
                <button
                  className={`${styles.colorOption} ${settings.annotationColorId === color.id ? styles.selected : ""}`}
                  style={
                    {
                      "--swatch": color.srgb,
                      "--swatch-p3": color.p3,
                    } as React.CSSProperties
                  }
                  onClick={() =>
                    onSettingsChange({ annotationColorId: color.id })
                  }
                  title={color.label}
                  aria-label={color.label}
                  type="button"
                  key={color.id}
                ></button>
              ))}
            </div>
          </div>

          <div className={styles.divider}></div>

          {/* Checkboxes */}
          <div className={styles.settingsSection}>
            <CheckboxField
              className="checkbox-field"
              label="Clear on copy/send"
              checked={settings.autoClearAfterCopy}
              onChange={(e) =>
                onSettingsChange({ autoClearAfterCopy: e.target.checked })
              }
              tooltip="Automatically clear annotations after copying"
            />
            <CheckboxField
              className={styles.checkboxField}
              label="Block page interactions"
              checked={settings.blockInteractions}
              onChange={(e) =>
                onSettingsChange({ blockInteractions: e.target.checked })
              }
            />
          </div>

          <div className={styles.divider} />

          {/* Nav to automations */}
          <button
            className={styles.settingsNavLink}
            ref={navRef}
            onClick={(event) => {
              focusPageRef.current = event.detail === 0;
              event.currentTarget.blur();
              onSettingsPageChange("automations");
            }}
          >
            <span>Manage MCP & Webhooks</span>
            <span className={styles.settingsNavLinkRight}>
              {endpoint && connectionStatus !== "disconnected" && (
                <span
                  className={`${styles.mcpNavIndicator} ${styles[connectionStatus]}`}
                />
              )}
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M7.5 12.5L12 8L7.5 3.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </button>
        </div>

        {/* ── Automations page ── */}
        <div
          className={`${styles.settingsPage} ${styles.automationsPage} ${settingsPage === "automations" ? styles.slideIn : ""}`}
          ref={(node) => { node?.toggleAttribute("inert", settingsPage !== "automations"); }}
          aria-hidden={settingsPage !== "automations"}
        >
          <button
            className={styles.settingsBackButton}
            ref={backRef}
            aria-label="Back to settings"
            onClick={(event) => {
              focusPageRef.current = event.detail === 0;
              event.currentTarget.blur();
              onSettingsPageChange("main");
            }}
          >
            <IconChevronLeft size={16} />
            <span>Manage MCP & Webhooks</span>
          </button>

          <div className={styles.divider}></div>

          {/* MCP section */}
          <div className={styles.settingsSection}>
            <div className={styles.settingsRow}>
              <span className={styles.automationHeader}>
                MCP Connection
                <HelpTooltip content="Connect via Model Context Protocol to let AI agents like Claude Code receive annotations in real-time." />
              </span>
              {endpoint && (
                <div
                  className={`${styles.mcpStatusDot} ${styles[connectionStatus]}`}
                  title={
                    connectionStatus === "connected"
                      ? "Connected"
                      : connectionStatus === "connecting"
                        ? "Connecting..."
                        : "Disconnected"
                  }
                />
              )}
            </div>
            <p
              className={styles.automationDescription}
              style={{ paddingBottom: 6 }}
            >
              MCP connection allows agents to receive and act on annotations.{" "}
              <a
                href="https://agentation.com/mcp"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.learnMoreLink}
              >
                Learn more
              </a>
            </p>
          </div>

          <div className={styles.divider}></div>

          {/* Webhooks section */}
          <div
            className={`${styles.settingsSection} ${styles.settingsSectionGrow}`}
          >
            <div className={styles.settingsRow}>
              <span className={styles.automationHeader}>
                Webhooks
                <HelpTooltip content="Send annotation data to any URL endpoint when annotations change. Useful for custom integrations." />
              </span>
              <div className={styles.autoSendContainer}>
                <label
                  htmlFor="agentation-auto-send"
                  className={`${styles.autoSendLabel} ${settings.webhooksEnabled ? styles.active : ""} ${!settings.webhookUrl ? styles.disabled : ""}`}
                >
                  Auto-Send
                </label>
                <Switch
                  id="agentation-auto-send"
                  checked={settings.webhooksEnabled}
                  onChange={(e) =>
                    onSettingsChange({
                      webhooksEnabled: e.target.checked,
                    })
                  }
                  disabled={!settings.webhookUrl}
                />
              </div>
            </div>
            <p className={styles.automationDescription}>
              The webhook URL will receive live annotation changes and
              annotation data.
            </p>
            <textarea
              className={styles.webhookUrlInput}
              placeholder="Webhook URL"
              aria-label="Webhook URL"
              value={settings.webhookUrl}
              onKeyDown={(e) => e.stopPropagation()}
              onChange={(e) => onSettingsChange({ webhookUrl: e.target.value })}
            />
          </div>
        </div>
      </div>
    </div>
  );
});
