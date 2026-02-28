import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import ru from "./locales/ru.json";
import uk from "./locales/uk.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import ja from "./locales/ja.json";
import pt from "./locales/pt.json";
import pl from "./locales/pl.json";
import ko from "./locales/ko.json";
import zh from "./locales/zh.json";
import de from "./locales/de.json";
import it from "./locales/it.json";
import ar from "./locales/ar.json";
import cs from "./locales/cs.json";
import hi from "./locales/hi.json";
import kk from "./locales/kk.json";

const resources = {
  en: { translation: en },
  ru: { translation: ru },
  uk: { translation: uk },
  es: { translation: es },
  fr: { translation: fr },
  ja: { translation: ja },
  pt: { translation: pt },
  pl: { translation: pl },
  ko: { translation: ko },
  zh: { translation: zh },
  de: { translation: de },
  it: { translation: it },
  ar: { translation: ar },
  cs: { translation: cs },
  hi: { translation: hi },
  kk: { translation: kk },
};

const SUPPORTED_LANGUAGES = ["en", "ru", "uk", "es", "fr", "ja", "pt", "pl", "ko", "zh", "de", "it", "ar", "cs", "hi", "kk"];

/**
 * Определяет язык системы на основе navigator.language или navigator.languages
 * Пытается найти точное совпадение, затем язык без региона, затем fallback
 */
const detectSystemLanguage = (): string => {
  try {
    // Получаем язык браузера (например: "ru-RU", "en-US", "ja-JP")
    const browserLanguages = navigator.languages
      ? Array.from(navigator.languages)
      : [navigator.language];

    // Нормализуем и проверяем каждый язык
    for (const lang of browserLanguages) {
      // Точное совпадение (например: "ru" в "ru-RU")
      const langCode = lang.split("-")[0].toLowerCase();
      if (SUPPORTED_LANGUAGES.includes(langCode)) {
        return langCode;
      }
    }
  } catch (error) {
    console.error("Ошибка при определении языка системы:", error);
  }

  // Fallback на английский если язык не определён
  return "en";
};

/**
 * Получает язык для инициализации:
 * 1. Если есть сохранённый выбор пользователя -> используем его
 * 2. Если первый запуск -> определяем язык системы
 * 3. Fallback -> английский
 */
const getInitialLanguage = (): string => {
  const savedLanguage = localStorage.getItem("app-language");

  // Если пользователь уже выбирал язык, используем сохранённое значение
  if (savedLanguage && SUPPORTED_LANGUAGES.includes(savedLanguage)) {
    return savedLanguage;
  }

  // При первом запуске определяем язык системы
  const systemLanguage = detectSystemLanguage();
  return systemLanguage;
};

i18next
  .use(initReactI18next)
  .init({
    resources,
    lng: getInitialLanguage(),
    fallbackLng: "en",
    supportedLngs: SUPPORTED_LANGUAGES,
    interpolation: {
      escapeValue: false,
    },
  });

// Сохраняем предпочтение языка при его изменении
i18next.on("languageChanged", (lng) => {
  localStorage.setItem("app-language", lng);
});

export default i18next;
