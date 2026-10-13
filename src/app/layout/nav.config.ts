import type { IconName } from '../shared/components/icon.component';

export interface NavItem {
  label: string;
  icon: IconName;
  route: string;
  /** Optional exact-match hint for router active state. */
  exact?: boolean;
}

export interface NavSection {
  label?: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { label: 'Dashboard', icon: 'dashboard', route: '/dashboard' },
      { label: 'All Files', icon: 'files', route: '/files' },
      { label: 'Recent', icon: 'clock', route: '/recent' },
      { label: 'Starred', icon: 'star', route: '/starred' },
    ],
  },
  {
    label: 'Create & Convert',
    items: [
      { label: 'PDF Tools', icon: 'wrench', route: '/tools' },
      { label: 'Edit PDF', icon: 'square-pen', route: '/tools/edit', exact: true },
      { label: 'Document Editor', icon: 'edit', route: '/editor' },
      { label: 'Image Tools', icon: 'image', route: '/image-tools' },
      { label: 'Converters', icon: 'arrow-right-left', route: '/converters' },
    ],
  },
  {
    items: [
      { label: 'Trash', icon: 'trash', route: '/trash' },
      { label: 'Settings', icon: 'settings', route: '/settings' },
    ],
  },
];
