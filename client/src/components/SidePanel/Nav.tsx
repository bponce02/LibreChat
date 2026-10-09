import type { NavLink } from '~/common';
import { useActivePanel, resolveActivePanel } from '~/Providers';

export default function Nav({ links }: { links: NavLink[] }) {
  const { active } = useActivePanel();
  const effectiveActive = resolveActivePanel(active, links);
  return (
    <div className="text-text-primary flex h-full min-h-0 flex-col overflow-x-hidden overflow-y-auto">
      {links.map((link) => {
        if (!link.Component) return null;
        if (link.keepMounted)
          return (
            <div
              key={link.id}
              className={link.id === effectiveActive ? 'flex h-full min-h-0 flex-col' : 'hidden'}
            >
              <link.Component />
            </div>
          );
        return link.id === effectiveActive ? <link.Component key={link.id} /> : null;
      })}
    </div>
  );
}
