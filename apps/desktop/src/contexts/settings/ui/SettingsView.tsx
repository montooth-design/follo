import { SectionCard, Heading } from '../../../shared/ui';
import type { Settings } from '@follo/shared';
import { Moon, Sun } from 'lucide-react';
import { AiSettings } from '../../ai/ui/AiSettings';

interface SettingsViewProps {
  settings: Settings;
  saving: boolean;
  ready: boolean;
  onChangeTheme: (theme: Settings['theme']) => Promise<void>;
}

export function SettingsView({ settings, saving, ready, onChangeTheme }: SettingsViewProps) {
  return (
    <div className="settings-panel">
      <SectionCard variant="settings" className="theme-card" aria-label="Theme settings">
        <Heading as="h2" variant="section">
          Theme
        </Heading>
        <div className="theme-options">
          {(['dark', 'light'] as const).map((theme) => (
            <button
              key={theme}
              disabled={saving || !ready}
              aria-pressed={settings.theme === theme}
              className={settings.theme === theme ? 'theme selected' : 'theme'}
              onClick={() => void onChangeTheme(theme)}
            >
              {theme === 'dark' ? <Moon /> : <Sun />} {theme === 'dark' ? 'Dark' : 'Light'}
            </button>
          ))}
        </div>
      </SectionCard>
      <AiSettings />
    </div>
  );
}
