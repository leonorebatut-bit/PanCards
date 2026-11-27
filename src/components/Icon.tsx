// Icônes unicolores (elles prennent la couleur du texte autour)
const PATHS = {
  home: 'M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10',
  booster: 'M4 8h16v12H4zM2 8h20M12 8v12M12 8c-2-3-6-3-6-1s4 1 6 1c2 0 6 1 6-1s-4-2-6 1',
  album: 'M4 4h6a2 2 0 012 2v14a2 2 0 00-2-2H4zM20 4h-6a2 2 0 00-2 2v14a2 2 0 012-2h6z',
  plus: 'M12 5v14M5 12h14',
  swap: 'M4 8h13l-3-3M20 16H7l3 3',
  users: 'M9 11a4 4 0 100-8 4 4 0 000 8zM2 21v-1a6 6 0 0112 0v1M16 3.5a4 4 0 010 7.5M22 21v-1a6 6 0 00-4-5.6',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21v-1a8 8 0 0116 0v1',
  rules: 'M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
  globe: 'M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9S14.5 18.5 12 21c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3',
  lock: 'M6 11h12v10H6zM8 11V8a4 4 0 018 0v3',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 16,
  filled = false,
  label,
}: {
  name: IconName;
  size?: number;
  filled?: boolean;
  /** Texte lu par les lecteurs d'écran ; sans lui l'icône est décorative */
  label?: string;
}) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
