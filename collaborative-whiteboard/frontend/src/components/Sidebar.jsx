import React from 'react';

// Renders the initials of a userId like "user_a1b2c3d4" -> "A1"
function getInitials(userId) {
  const stripped = userId.replace(/^user_/, '');
  return stripped.slice(0, 2).toUpperCase();
}

export default function Sidebar({ users, myUserId, myColor }) {
  return (
    <aside className="w-60 bg-ink-900 border-l border-ink-700 flex flex-col">
      <div className="px-4 py-3 border-b border-ink-700">
        <p className="text-xs uppercase tracking-wide text-slate-500 font-medium">Active Users</p>
        <p className="text-2xl font-semibold mt-0.5">{users.length}</p>
      </div>

      <div className="flex-1 overflow-y-auto thin-scrollbar px-3 py-3 space-y-2">
        {users.length === 0 && (
          <p className="text-xs text-slate-500 px-1">Waiting for users to join…</p>
        )}

        {users.map((u) => {
          const isMe = u.userId === myUserId;
          return (
            <div
              key={u.userId}
              className="flex items-center gap-3 px-2 py-2 rounded-lg bg-ink-800/60 border border-ink-700/60"
            >
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-ink-950 flex-shrink-0"
                style={{ backgroundColor: isMe ? myColor : u.color }}
                title={u.userId}
              >
                {getInitials(u.userId)}
              </div>
              <div className="overflow-hidden">
                <p className="text-sm font-medium truncate">
                  {isMe ? 'You' : u.userId}
                </p>
                <p className="text-[11px] text-slate-500">Online</p>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
