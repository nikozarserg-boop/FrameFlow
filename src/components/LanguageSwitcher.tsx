import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import "./LanguageSwitcher.css";

const LANGUAGES = [
  { code: "en", label: "common.english" },
  { code: "ru", label: "common.russian" },
  { code: "uk", label: "common.ukrainian" },
  { code: "es", label: "common.spanish" },
  { code: "fr", label: "common.french" },
  { code: "ja", label: "common.japanese" },
  { code: "pt", label: "common.portuguese" },
  { code: "pl", label: "common.polish" },
  { code: "ko", label: "common.korean" },
  { code: "zh", label: "common.chinese" },
  { code: "de", label: "common.german" },
  { code: "it", label: "common.italian" },
  { code: "ar", label: "common.arabic" },
  { code: "cs", label: "common.czech" },
  { code: "hi", label: "common.hindi" },
  { code: "kk", label: "common.kazakh" },
];

export default function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleSelectLanguage = (code: string) => {
    void i18n.changeLanguage(code);
    setIsOpen(false);
  };

  const currentLanguage = LANGUAGES.find((lang) => lang.code === i18n.language);

  return (
    <div className="language-switcher" ref={containerRef}>
      <label className="language-switcher-label">
        {t("common.language")}:
      </label>
      <div className="language-switcher-wrapper">
        <button
          className="language-switcher-button"
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
        >
          <span className="language-switcher-current">
            {currentLanguage ? t(currentLanguage.label) : i18n.language}
          </span>
          <span className="language-switcher-arrow">▼</span>
        </button>

        {isOpen && (
          <div className="language-switcher-dropdown">
            <ul className="language-switcher-list">
              {LANGUAGES.map((lang) => (
                <li key={lang.code}>
                  <button
                    className={`language-switcher-option ${
                      lang.code === i18n.language ? "active" : ""
                    }`}
                    onClick={() => handleSelectLanguage(lang.code)}
                  >
                    {t(lang.label)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
