import { memo, useLayoutEffect, useRef, useState } from "react";
import { Annotation } from "../../../types";
import { IconChevronRight, IconEdit, IconPlus, IconXmark } from "../../icons";
import { useExitCompletion } from "../../../hooks/use-exit-completion";
import type { PinSide } from "../../../utils/scroll-containers";
import styles from "./styles.module.scss";

type MarkerClickBehavior = "edit" | "delete";

// =============================================================================
// AnnotationMarker
// =============================================================================

type AnnotationMarkerProps = {
  annotation: Annotation;
  pending?: boolean;
  /** Held at this edge of a scroll container because its target is out of view. */
  pinned?: PinSide;
  globalIndex: number;
  /** Display index within this layer (for staggered animation delays) */
  layerIndex: number;
  layerSize: number;
  isExiting: boolean;
  isClearing: boolean;
  isAnimated: boolean;
  isNew: boolean;
  isHovered: boolean;
  isRemoving: boolean;
  onRemoveComplete: (id: string) => void;
  isEditingAny: boolean;
  renumberFrom: number | null;
  markerClickBehavior: MarkerClickBehavior;
  onHoverEnter: (annotation: Annotation) => void;
  onEnterComplete: (id: string) => void;
  onHoverLeave: (id: string) => void;
  onClick: (annotation: Annotation, trigger: HTMLButtonElement) => void;
  onContextMenu?: (annotation: Annotation, trigger: HTMLButtonElement) => void;
};

export const AnnotationMarker = memo(function AnnotationMarker({
  annotation,
  pending = false,
  pinned,
  globalIndex,
  layerIndex,
  layerSize,
  isExiting,
  isClearing,
  isAnimated,
  isNew,
  isHovered,
  isRemoving,
  onRemoveComplete,
  isEditingAny,
  renumberFrom,
  markerClickBehavior,
  onHoverEnter,
  onEnterComplete,
  onHoverLeave,
  onClick,
  onContextMenu,
}: AnnotationMarkerProps) {
  const [hasEntered, setHasEntered] = useState(isAnimated);
  const beganPending = useRef(pending);
  const [hasConfirmed, setHasConfirmed] = useState(false);
  // Fast submissions finish the entrance already in flight, without restarting it.
  const confirming = beganPending.current && !pending && hasEntered && !hasConfirmed;
  useLayoutEffect(() => {
    if (isExiting) setHasEntered(false);
  }, [isExiting]);
  const markerRef = useRef<HTMLButtonElement>(null);
  const restingContent = useRef({ action: false, delete: false });
  const action = isHovered && !isEditingAny;
  const deleteHover = action && markerClickBehavior === "delete" && !pinned;
  useLayoutEffect(() => {
    if (!isRemoving) restingContent.current = { action, delete: deleteHover };
  }, [isRemoving, action, deleteHover]);
  // Preserve the visible glyph and colour while this same marker leaves.
  const showAction = isRemoving ? restingContent.current.action : action;
  const showDeleteHover = isRemoving ? restingContent.current.delete : deleteHover;
  useExitCompletion(markerRef, isRemoving, () => onRemoveComplete(annotation.id));
  const isMulti = annotation.isMultiSelect;

  const markerColor = isMulti
    ? "var(--agentation-color-green)"
    : "var(--agentation-color-accent)";

  const animClass = isClearing
    ? styles.clearing
    : isExiting || isRemoving
      ? styles.exit
      : confirming
        ? styles.confirm
        : !isAnimated && !hasEntered
        ? styles.enter
        : "";

  const animationDelay = isClearing
    ? `${Math.min(layerIndex * 20, 120)}ms`
    : isRemoving || pending || confirming
    ? "0ms"
    : isExiting
    ? `${(layerSize - 1 - layerIndex) * 20}ms`
    : `${isNew ? 0 : layerIndex * 20}ms`;

  return (
    <button
      ref={markerRef}
      type="button"
      aria-label={pending ? "Pending annotation" : `${pinned ? "Scroll to" : markerClickBehavior === "delete" ? "Delete" : "Edit"} annotation ${globalIndex + 1}: ${annotation.element}`}
      disabled={pending || isExiting || isRemoving || isClearing}
      tabIndex={pending || isEditingAny ? -1 : 0}
      className={`${styles.marker} ${pending ? styles.pending : ""} ${isMulti ? styles.multiSelect : ""} ${animClass} ${!pending && showAction ? styles.actionVisible : ""} ${showDeleteHover ? styles.hovered : ""} ${isHovered && !isEditingAny && !isRemoving ? styles.previewVisible : ""} ${pinned ? styles.pinned : ""}`}
      data-annotation-marker={pending ? undefined : ""}
      data-pinned={pinned}
      data-annotation-pending={pending ? "" : undefined}
      style={{
        left: `${annotation.x}%`,
        top: annotation.y,
        backgroundColor: showDeleteHover ? undefined : markerColor,
        animationDelay,
      }}
      onAnimationEnd={(event) => {
        if (event.target !== event.currentTarget) return;
        if (animClass === styles.enter || animClass === styles.confirm) {
          setHasEntered(true);
          if (!pending) setHasConfirmed(true);
          if (!pending) onEnterComplete(annotation.id);
        }
      }}
      // React's synthetic mouseenter can miss entry across a shadow boundary
      // from another React element. Bubbling mouseover reaches the marker.
      onMouseOver={() => { if (!pending) onHoverEnter(annotation); }}
      onMouseOut={(event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) {
          onHoverLeave(annotation.id);
        }
      }}
      onFocus={(event) => {
        if (!pending && event.currentTarget.matches(":focus-visible")) onHoverEnter(annotation);
      }}
      onBlur={() => onHoverLeave(annotation.id)}
      onClick={(e) => {
        e.stopPropagation();
        if (!pending && !isExiting && !isRemoving) onClick(annotation, e.currentTarget);
      }}
      onContextMenu={
        onContextMenu
          ? (e) => {
              if (markerClickBehavior === "delete") {
                e.preventDefault();
                e.stopPropagation();
                if (!pending && !isExiting && !isRemoving) onContextMenu(annotation, e.currentTarget);
              }
            }
          : undefined
      }
    >
      <span
        key={globalIndex}
        className={`${styles.number} ${renumberFrom !== null && globalIndex >= renumberFrom ? styles.renumber : ""}`}
        aria-hidden="true"
      >
        <span className={styles.numberGlyph}>{globalIndex + 1}</span>
      </span>
      <span className={styles.actionGlyph} aria-hidden="true">
        {pinned ? (
          <IconChevronRight size={16} />
        ) : markerClickBehavior === "delete" ? (
          <IconXmark size={isMulti ? 18 : 16} />
        ) : (
          <IconEdit size={16} />
        )}
      </span>
      {beganPending.current && <span className={styles.plus} aria-hidden="true"><IconPlus size={12} /></span>}
    </button>
  );
});
