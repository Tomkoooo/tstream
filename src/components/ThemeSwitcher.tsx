'use client';

import { useState, useEffect } from 'react';
import { IconSun, IconMoon, IconDeviceDesktop } from '@tabler/icons-react';

const themes = [
  { name: 'light', label: 'Light', icon: IconSun },
  { name: 'dark', label: 'Dark', icon: IconMoon },
  { name: 'auto', label: 'Auto', icon: IconDeviceDesktop }
];

export default function ThemeSwitcher() {
  const [currentTheme, setCurrentTheme] = useState<string>('dark');

  useEffect(() => {
    // Get theme from localStorage or default to dark
    const savedTheme = localStorage.getItem('theme') || 'dark';
    setCurrentTheme(savedTheme);
    applyTheme(savedTheme);
  }, []);

  const applyTheme = (theme: string) => {
    const html = document.documentElement;
    
    if (theme === 'auto') {
      // Use system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      html.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
      html.setAttribute('data-theme', theme);
    }
  };

  const handleThemeChange = (theme: string) => {
    setCurrentTheme(theme);
    localStorage.setItem('theme', theme);
    applyTheme(theme);
  };

  return (
    <div className="dropdown dropdown-end">
      <div tabIndex={0} role="button" className="btn btn-ghost">
        {(() => {
          const theme = themes.find(t => t.name === currentTheme);
          if (!theme) return null;
          const Icon = theme.icon;
          return <Icon className="w-5 h-5" />;
        })()}
      </div>
      <ul tabIndex={0} className="dropdown-content menu bg-base-100 rounded-box z-[1] w-52 p-2 shadow border border-base-300">
        {themes.map((theme) => {
          const IconComponent = theme.icon;
          return (
            <li key={theme.name}>
              <button
                onClick={() => handleThemeChange(theme.name)}
                className={`flex items-center gap-3 ${
                  currentTheme === theme.name ? 'active' : ''
                }`}
              >
                <IconComponent className="w-4 h-4" />
                {theme.label}
                {currentTheme === theme.name && (
                  <span className="ml-auto text-primary">✓</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
