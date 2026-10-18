import Link from 'next/link';
import MyCommunities from '@/app/components/MyCommunities';
import BottomNav from '@/app/components/BottomNav';
export default function Page(){return <main className="min-h-screen bg-[#02030a] text-white pb-32"><div className="max-w-md mx-auto px-4 py-6 space-y-6"><h1 className="text-3xl font-bold">Мои сообщества</h1><MyCommunities/><Link className="block p-4 min-h-11 rounded-xl border border-violet-600 text-violet-200" href="/communities/create">Создать сообщество →</Link><Link className="block min-h-11 py-3 text-gray-300" href="/open-games">Найти открытую игру →</Link></div><BottomNav/></main>;}
