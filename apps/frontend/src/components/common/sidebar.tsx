'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  MessageSquare,
  Zap,
  Activity,
  Users,
  FolderOpen,
  FileText,
  Settings,
  Phone,
} from 'lucide-react';

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'CRM', href: '/crm', icon: MessageSquare },
  { name: 'Campaigns', href: '/campaigns', icon: Zap },
  { name: 'Sequences', href: '/sequences', icon: Activity },
  { name: 'Accounts', href: '/accounts', icon: Phone },
  { name: 'Groups', href: '/groups', icon: FolderOpen },
  { name: 'Templates', href: '/templates', icon: FileText },
  { name: 'Leads', href: '/leads', icon: Users },
  { name: 'Settings', href: '/settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="flex h-screen w-64 flex-col border-r bg-card">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2 border-b px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-telegram">
          <Zap className="h-5 w-5 text-white" />
        </div>
        <span className="text-lg font-semibold">Outreach</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-4">
        {navigation.map((item) => {
          const isActive = pathname === item.href ||
            (item.href !== '/' && pathname.startsWith(item.href));

          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.name}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t p-4">
        <div className="flex items-center gap-3 rounded-lg bg-muted px-3 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-telegram text-white text-sm font-medium">
            A
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">Admin</p>
            <p className="text-xs text-muted-foreground">Online</p>
          </div>
        </div>
      </div>
    </div>
  );
}
