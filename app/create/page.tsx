import Link from 'next/link';
import MyCommunities from '@/app/components/MyCommunities';
import BottomNav from '@/app/components/BottomNav';
export default function Page(){return <main className="min-h-screen bg-[#02030a] text-white pb-32"><div className="max-w-md mx-auto px-4 py-6 space-y-6"><h1 className="text-3xl font-bold">Создать</h1><Link href="/communities/create" className="block min-h-11 p-5 rounded-xl bg-violet-700 font-bold">Новое сообщество →</Link><h2 className="text-xl font-bold">Игровой день</h2><p className="text-gray-300">Выбери сообщество, в котором ты управляешь играми.</p><MyCommunities creation/></div><BottomNav/></main>;}
