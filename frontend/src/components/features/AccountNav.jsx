import { Link } from 'react-router-dom';
import { User, Shield, Key } from 'lucide-react';

const ITEMS = [
  { id: 'profile', label: 'Profile', icon: User, path: '/account/profile' },
  { id: 'security', label: 'Security', icon: Shield, path: '/account/security' },
  { id: 'api-keys', label: 'API Keys', icon: Key, path: '/account/api-keys' },
];

export default function AccountNav({ current }) {
  return (
    <div className="flex items-center gap-4 text-xs">
      {ITEMS.map((item, i) => {
        const Icon = item.icon;
        const active = item.id === current;
        return (
          <div key={item.id} className="flex items-center gap-4">
            {i > 0 && <span className="text-white/15">·</span>}
            <Link
              to={item.path}
              className={`flex items-center gap-1.5 transition-colors ${active ? 'text-white' : 'text-white/40 hover:text-white'}`}
            >
              <Icon className="w-3.5 h-3.5" strokeWidth={1.5} />
              {item.label}
            </Link>
          </div>
        );
      })}
    </div>
  );
}
