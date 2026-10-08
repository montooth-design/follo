import { ViewHeader } from '../shared/ui';
import React, { useEffect, useState } from 'react';
import type { AppStatus, Settings, RecentRepository, Repository } from '@follo/shared';
import {
  House,
  Folder,
  Network,
  Search,
  Sparkles,
  Settings as SettingsIcon,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { RepositoriesView } from '../contexts/repositories/ui/RepositoriesView';
import { CodeMapsView } from '../contexts/code-intelligence/ui/CodeMapsView';
import { SearchView } from '../contexts/search/ui/SearchView';
import { AskView } from '../contexts/conversations/ui/AskView';
import { Logo } from '../shared/branding/Logo';
import { OverviewView } from '../contexts/overview/ui/OverviewView';
import { SettingsView } from '../contexts/settings/ui/SettingsView';
import { VIEW_COPY } from './view-copy';

const sections = ['Overview', 'Repositories', 'Code Maps', 'Search', 'Ask', 'Settings'] as const;
type Section = (typeof sections)[number];
const icons = {
  Overview: House,
  Repositories: Folder,
  'Code Maps': Network,
  Search,
  Ask: Sparkles,
  Settings: SettingsIcon,
};

export function App() {
  const [section, setSection] = useState<Section>('Overview');
  const [status, setStatus] = useState<AppStatus>();
  const [settings, setSettings] = useState<Settings>({ theme: 'dark' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [repositories, setRepositories] = useState<RecentRepository[]>([]);
  const [repository, setRepository] = useState<Repository>();
  const [repositoriesExpanded, setRepositoriesExpanded] = useState(false);
  const [requested, setRequested] = useState<{
    id: string;
    revision: number;
    focusPermissions?: boolean;
  }>();
  useEffect(() => {
    const bridge = window.engineering;

    if (!bridge) {
      setError('Desktop bridge unavailable. Start Follo with npm run dev.');

      return;
    }

    Promise.all([bridge.getStatus(), bridge.getSettings()])
      .then(([info, prefs]) => {
        setStatus(info);
        setSettings(prefs);
      })
      .catch((error) => setError(String(error)));
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  function openRepositoryPermissions(id: string) {
    setSection('Repositories');
    setRepositoriesExpanded(true);
    setRequested((previous) => ({
      id,
      revision: (previous?.revision ?? 0) + 1,
      focusPermissions: true,
    }));
  }

  async function changeTheme(theme: Settings['theme']) {
    if (!window.engineering) return;
    setSaving(true);
    setError('');

    try {
      setSettings(await window.engineering.updateSettings({ theme }));
    } catch (error) {
      setError(String(error));
    } finally {
      setSaving(false);
    }
  }

  // Repository and Ask panels remain mounted below to preserve their session state.
  // Other views mount only while visible and clean up their own work on exit.
  let activeView: React.ReactNode = null;

  switch (section) {
    case 'Overview':
      activeView = <OverviewView onOpenRepositories={() => setSection('Repositories')} />;
      break;
    case 'Code Maps':
      activeView = (
        <CodeMapsView
          onSettings={() => setSection('Settings')}
          onRepository={openRepositoryPermissions}
        />
      );
      break;
    case 'Search':
      activeView = <SearchView onSettings={() => setSection('Settings')} />;
      break;
    case 'Settings':
      activeView = (
        <SettingsView
          settings={settings}
          saving={saving}
          ready={Boolean(status)}
          onChangeTheme={changeTheme}
        />
      );
      break;
  }

  return (
    <div className="app">
      <aside className={`sidebar${sidebarCollapsed ? ' collapsed' : ''}`}>
        <div className="brand">
          <Logo compact={sidebarCollapsed} />
        </div>
        <button
          className="sidebar-toggle"
          aria-label={sidebarCollapsed ? 'Expand Menu' : 'Collapse Menu'}
          title={sidebarCollapsed ? 'Expand Menu' : 'Collapse Menu'}
          aria-expanded={!sidebarCollapsed}
          onClick={() => setSidebarCollapsed((value) => !value)}
        >
          {sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </button>

        <nav aria-label="Main navigation">
          {sections.map((item) => {
            const Icon = icons[item];

            return (
              <React.Fragment key={item}>
                <button
                  className={section === item ? 'nav active' : 'nav'}
                  onClick={() => {
                    setSection(item);

                    if (item === 'Repositories') {
                      setRepositoriesExpanded((value) => !value);
                      if (sidebarCollapsed) setSidebarCollapsed(false);
                    }
                  }}
                  aria-label={item}
                  title={item}
                  aria-expanded={item === 'Repositories' ? repositoriesExpanded : undefined}
                  aria-current={section === item ? 'page' : undefined}
                >
                  <span className="nav-icon">
                    <Icon />
                  </span>
                  <span className="nav-label">{item}</span>
                  {item === 'Repositories' && (
                    <span className="submenu-toggle">
                      {repositoriesExpanded ? <ChevronDown /> : <ChevronRight />}
                    </span>
                  )}
                  {item === 'Ask' && <span className="optional">AI</span>}
                </button>
                {item === 'Repositories' && repositoriesExpanded && !sidebarCollapsed && (
                  <div className="repository-submenu">
                    {repositories.map((repo) => (
                      <button
                        key={repo.id}
                        title={repo.path}
                        aria-label={`Open ${repo.name}`}
                        aria-current={
                          section === 'Repositories' && repository?.id === repo.id
                            ? 'page'
                            : undefined
                        }
                        onClick={() => {
                          setSection('Repositories');
                          setRequested((previous) => ({
                            id: repo.id,
                            revision: (previous?.revision ?? 0) + 1,
                          }));
                        }}
                      >
                        <Folder />
                        <span>{repo.name}</span>
                      </button>
                    ))}
                    {!repositories.length && <small>No repositories opened</small>}
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </nav>
        <div className="sidebar-bottom" title="Local workspace">
          <span className="dot" />
          <span className="sidebar-status"> Local workspace</span>
          <div className="muted">Local analysis · v{status?.version ?? '0.21.0'}</div>
        </div>
      </aside>
      <div className="workspace">
        <header>
          <span>
            Workspace <span className="slash">/</span>{' '}
            {section === 'Repositories' ? (repository?.name ?? section) : section}
          </span>
        </header>
        <main className={section === 'Overview' ? 'overview-view' : undefined}>
          {section !== 'Repositories' && section !== 'Overview' && (
            <ViewHeader
              title={VIEW_COPY[section].heading}
              subtitle={VIEW_COPY[section].subheading}
            />
          )}
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          <div hidden={section !== 'Repositories'}>
            <RepositoriesView
              ready={Boolean(status)}
              active={section === 'Repositories'}
              requested={requested}
              onRepositories={setRepositories}
              onSelected={setRepository}
            />
          </div>
          <div hidden={section !== 'Ask'}>
            {status && <AskView active={section === 'Ask'} onNavigate={setSection} />}
          </div>
          {activeView}
        </main>
        <footer>
          <span>
            <span className="dot" /> {status ? 'Local storage connected' : 'Connecting to desktop…'}
          </span>
        </footer>
      </div>
    </div>
  );
}
