import type { ComponentChildren } from 'preact';

/** Five-pointed star in a 24×24 box; shared by the completion card and the level map. */
export const STAR_PATH =
  'M12 2.8l2.75 5.82 6.35.8-4.66 4.4 1.2 6.3L12 17.03l-5.64 3.1 1.2-6.3L2.9 9.42l6.35-.8z';

function Icon({ children }: { children: ComponentChildren }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const PointIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="2" />
    <path d="M12 4v3M12 17v3M4 12h3M17 12h3" />
  </Icon>
);

export const LineIcon = () => (
  <Icon>
    <path d="M4 20 20 4" />
    <circle cx="4" cy="20" r="1.5" />
    <circle cx="20" cy="4" r="1.5" />
  </Icon>
);

export const CircleIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="0.75" />
    <path d="M12 12h8" />
  </Icon>
);

export const PerpBisectorIcon = () => (
  <Icon>
    <path d="M3 17h18" />
    <path d="M12 3v18" />
    <path d="M12 14h3v3" />
  </Icon>
);

export const UndoIcon = () => (
  <Icon>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
  </Icon>
);

export const RedoIcon = () => (
  <Icon>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H10a6 6 0 0 0 0 12h3" />
  </Icon>
);

export const ResetIcon = () => (
  <Icon>
    <path d="M4 12a8 8 0 1 0 2.5-5.8" />
    <path d="M4 4v4h4" />
  </Icon>
);

export const HintIcon = () => (
  <Icon>
    <path d="M9 18h6M10 21h4" />
    <path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z" />
  </Icon>
);

export const MapIcon = () => (
  <Icon>
    <path d="M4 7.5 9 5l6 2.5L20 5v11.5L15 19l-6-2.5L4 19Z" />
    <path d="M9 5v11.5M15 7.5V19" />
  </Icon>
);

export const SunIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
  </Icon>
);

export const MoonIcon = () => (
  <Icon>
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
  </Icon>
);

export const CloseIcon = () => (
  <Icon>
    <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" />
  </Icon>
);

export const ArrowIcon = () => (
  <Icon>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);

export const BackIcon = () => (
  <Icon>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Icon>
);

export const SegmentIcon = () => (
  <Icon>
    <path d="M5 19 19 5" />
    <circle cx="5" cy="19" r="1.75" fill="currentColor" />
    <circle cx="19" cy="5" r="1.75" fill="currentColor" />
  </Icon>
);

export const RayIcon = () => (
  <Icon>
    <path d="M5 19 20.5 3.5" />
    <circle cx="5" cy="19" r="1.75" fill="currentColor" />
    <path d="M14.5 4h6.5v6.5" />
  </Icon>
);

/** A full line: runs off both edges, with two points on it. */
export const FullLineIcon = () => (
  <Icon>
    <path d="M2 22 22 2" />
    <circle cx="8" cy="16" r="1.5" fill="currentColor" />
    <circle cx="16" cy="8" r="1.5" fill="currentColor" />
  </Icon>
);

/** A circle without its centre (the Hide centre option). */
export const HiddenCentreIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="8" />
    <path d="M10 10l4 4M14 10l-4 4" />
  </Icon>
);

export const TrashIcon = () => (
  <Icon>
    <path d="M4.5 7h15M10 4h4M6.5 7l.9 12.1a1 1 0 0 0 1 .9h7.2a1 1 0 0 0 1-.9L17.5 7" />
    <path d="M10 11v5M14 11v5" />
  </Icon>
);

export const FitIcon = () => (
  <Icon>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    <circle cx="12" cy="12" r="2.5" />
  </Icon>
);

export const CheckIcon = () => (
  <Icon>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);

/** Outline star; `filled` fills it (a marked target). */
export const StarIcon = ({ filled }: { filled?: boolean }) => (
  <Icon>
    <path d={STAR_PATH} fill={filled ? 'currentColor' : 'none'} />
  </Icon>
);
