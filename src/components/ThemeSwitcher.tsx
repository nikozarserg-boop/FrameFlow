import { useTheme } from "../hooks/useTheme";
import "./ThemeSwitcher.css";

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="sun-icon">
      <circle cx="12" cy="12" r="4.5" fill="currentColor" className="sun-core" />
      <g className="sun-rays" strokeLinecap="round" stroke="currentColor" strokeWidth="2">
        <line x1="12" y1="1.5" x2="12" y2="3.5" />
        <line x1="12" y1="20.5" x2="12" y2="22.5" />
        <line x1="22.5" y1="12" x2="20.5" y2="12" />
        <line x1="3.5" y1="12" x2="1.5" y2="12" />
        <line x1="18.8" y1="5.2" x2="17.3" y2="6.7" />
        <line x1="6.7" y1="17.3" x2="5.2" y2="18.8" />
        <line x1="18.8" y1="18.8" x2="17.3" y2="17.3" />
        <line x1="6.7" y1="6.7" x2="5.2" y2="5.2" />
      </g>
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="moon-icon">
      <path
        d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"
        fill="currentColor"
        className="moon-shape"
      />
      <g className="moon-stars" opacity="0.3">
        <circle cx="18" cy="7" r="0.8" fill="currentColor" />
        <circle cx="19.5" cy="10" r="0.6" fill="currentColor" />
        <circle cx="20" cy="14" r="0.7" fill="currentColor" />
      </g>
    </svg>
  );
}

export default function ThemeSwitcher() {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="theme-switcher">
      <button
        className={`theme-icon theme-icon--sun ${theme === "light" ? "theme-icon--active" : ""}`}
        onClick={toggleTheme}
        type="button"
        aria-label="Switch to light mode"
      >
        <SunIcon />
      </button>
      <button
        className={`theme-icon theme-icon--moon ${theme === "dark" ? "theme-icon--active" : ""}`}
        onClick={toggleTheme}
        type="button"
        aria-label="Switch to dark mode"
      >
        <MoonIcon />
      </button>
    </div>
  );
}
