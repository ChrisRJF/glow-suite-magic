// Dummy data voor GlowSuite — Nederlandse markt

export interface Appointment {
  id: string;
  customerName: string;
  service: string;
  time: string;
  duration: number; // minuten
  color: string;
  status: 'bevestigd' | 'in afwachting' | 'afgerond';
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  totalVisits: number;
  totalSpent: number;
  lastVisit: string;
  initials: string;
  weeksInactive?: number;
}

export interface Service {
  id: string;
  name: string;
  duration: number;
  price: number;
  category: string;
  color: string;
}

export interface AISuggestion {
  id: string;
  icon: string;
  title: string;
  description: string;
  action: string;
  priority: 'high' | 'medium' | 'low';
}

export interface Membership {
  id: string;
  name: string;
  price: number;
  perks: string[];
  popular?: boolean;
}

export const todaysAppointments: Appointment[] = [
  { id: '1', customerName: 'Emma de Vries', service: 'Balayage', time: '09:00', duration: 120, color: '#7B61FF', status: 'bevestigd' },
  { id: '2', customerName: 'Sophie Jansen', service: 'Knippen & Föhnen', time: '10:30', duration: 60, color: '#C850C0', status: 'bevestigd' },
  { id: '3', customerName: 'Lisa van den Berg', service: 'Keratine Behandeling', time: '12:00', duration: 90, color: '#7B61FF', status: 'in afwachting' },
  { id: '4', customerName: 'Fleur Bakker', service: 'Uitgroei Bijwerken', time: '14:00', duration: 60, color: '#C850C0', status: 'bevestigd' },
  { id: '5', customerName: 'Anna Visser', service: 'Knippen', time: '15:30', duration: 45, color: '#7B61FF', status: 'bevestigd' },
  { id: '6', customerName: 'Rosa Mulder', service: 'Diepteverzorging', time: '17:00', duration: 45, color: '#C850C0', status: 'in afwachting' },
];

export const customers: Customer[] = [
  { id: '1', name: 'Emma de Vries', phone: '+31 6 1234 5678', email: 'emma.devries@mail.nl', totalVisits: 24, totalSpent: 3240, lastVisit: '19-03-2026', initials: 'EV', weeksInactive: 0 },
  { id: '2', name: 'Sophie Jansen', phone: '+31 6 2345 6789', email: 'sophie.j@mail.nl', totalVisits: 18, totalSpent: 2100, lastVisit: '21-03-2026', initials: 'SJ', weeksInactive: 0 },
  { id: '3', name: 'Lisa van den Berg', phone: '+31 6 3456 7890', email: 'lisa.vdb@mail.nl', totalVisits: 12, totalSpent: 1890, lastVisit: '15-03-2026', initials: 'LB', weeksInactive: 1 },
  { id: '4', name: 'Fleur Bakker', phone: '+31 6 4567 8901', email: 'fleur.b@mail.nl', totalVisits: 31, totalSpent: 4520, lastVisit: '20-03-2026', initials: 'FB', weeksInactive: 0 },
  { id: '5', name: 'Anna Visser', phone: '+31 6 5678 9012', email: 'anna.v@mail.nl', totalVisits: 8, totalSpent: 960, lastVisit: '10-03-2026', initials: 'AV', weeksInactive: 2 },
  { id: '6', name: 'Rosa Mulder', phone: '+31 6 6789 0123', email: 'rosa.m@mail.nl', totalVisits: 15, totalSpent: 2340, lastVisit: '18-03-2026', initials: 'RM', weeksInactive: 0 },
  { id: '7', name: 'Noor Hendriks', phone: '+31 6 7890 1234', email: 'noor.h@mail.nl', totalVisits: 6, totalSpent: 720, lastVisit: '28-02-2026', initials: 'NH', weeksInactive: 3 },
  { id: '8', name: 'Merel de Wit', phone: '+31 6 8901 2345', email: 'merel.dw@mail.nl', totalVisits: 22, totalSpent: 3100, lastVisit: '17-03-2026', initials: 'MW', weeksInactive: 1 },
];

export const services: Service[] = [
  { id: '1', name: 'Knippen', duration: 45, price: 55, category: 'Haar', color: '#7B61FF' },
  { id: '2', name: 'Knippen & Föhnen', duration: 60, price: 72, category: 'Haar', color: '#7B61FF' },
  { id: '3', name: 'Balayage', duration: 120, price: 165, category: 'Kleur', color: '#C850C0' },
  { id: '4', name: 'Uitgroei Bijwerken', duration: 60, price: 85, category: 'Kleur', color: '#C850C0' },
  { id: '5', name: 'Keratine Behandeling', duration: 90, price: 135, category: 'Behandeling', color: '#9B59B6' },
  { id: '6', name: 'Diepteverzorging', duration: 45, price: 48, category: 'Behandeling', color: '#9B59B6' },
  { id: '7', name: 'Föhnen & Stylen', duration: 30, price: 38, category: 'Styling', color: '#E91E8C' },
  { id: '8', name: 'Opsteekkapsel', duration: 75, price: 110, category: 'Styling', color: '#E91E8C' },
];

export const aiSuggestions: AISuggestion[] = [
  { id: '1', icon: '📅', title: '3 lege plekken morgen', description: 'Dinsdag 10:00, 13:00 en 16:00 zijn vrij. Stuur een actie naar recente klanten.', action: 'Plekken Vullen', priority: 'high' },
  { id: '2', icon: '💌', title: 'Inactieve klanten bereiken', description: '4 klanten zijn al 4+ weken niet geweest. Stuur een persoonlijke herinnering.', action: 'Herinnering Sturen', priority: 'high' },
  { id: '3', icon: '💰', title: 'Omzetkans', description: 'Noor H. boekt normaal een behandeling erbij. Stel dit voor bij haar volgende bezoek.', action: 'Notitie Toegevoegd', priority: 'medium' },
  { id: '4', icon: '⭐', title: 'Review aanvragen', description: '3 klanten hadden gisteren een behandeling. Vraag om een Google review.', action: 'Verzoek Sturen', priority: 'low' },
];

export const memberships: Membership[] = [
  {
    id: '1',
    name: 'Basis',
    price: 39,
    perks: ['1x knippen per maand', '10% korting op behandelingen', 'Prioriteit boeken'],
  },
  {
    id: '2',
    name: 'Premium',
    price: 69,
    perks: ['1x knippen + föhnen per maand', '20% korting op kleurbehandelingen', 'Gratis diepteverzorging', 'Prioriteit boeken'],
    popular: true,
  },
  {
    id: '3',
    name: 'VIP',
    price: 99,
    perks: ['Onbeperkt knippen & föhnen', '30% korting op alles', 'Gratis keratine (1x/kwartaal)', 'Exclusieve early access'],
  },
];

export const weekDays = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za'];
export const timeSlots = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00'];

export const weekAppointments: Record<string, Appointment[]> = {
  Ma: todaysAppointments,
  Di: [
    { id: 't1', customerName: 'Merel de Wit', service: 'Knippen & Föhnen', time: '09:30', duration: 60, color: '#C850C0', status: 'bevestigd' },
    { id: 't2', customerName: 'Noor Hendriks', service: 'Diepteverzorging', time: '14:00', duration: 45, color: '#9B59B6', status: 'bevestigd' },
  ],
  Wo: [
    { id: 'w1', customerName: 'Emma de Vries', service: 'Uitgroei Bijwerken', time: '10:00', duration: 60, color: '#C850C0', status: 'bevestigd' },
    { id: 'w2', customerName: 'Fleur Bakker', service: 'Föhnen & Stylen', time: '11:30', duration: 30, color: '#E91E8C', status: 'bevestigd' },
    { id: 'w3', customerName: 'Sophie Jansen', service: 'Keratine Behandeling', time: '14:00', duration: 90, color: '#9B59B6', status: 'in afwachting' },
  ],
  Do: [
    { id: 'th1', customerName: 'Lisa van den Berg', service: 'Knippen', time: '09:00', duration: 45, color: '#7B61FF', status: 'bevestigd' },
    { id: 'th2', customerName: 'Anna Visser', service: 'Balayage', time: '13:00', duration: 120, color: '#C850C0', status: 'bevestigd' },
  ],
  Vr: [
    { id: 'f1', customerName: 'Rosa Mulder', service: 'Opsteekkapsel', time: '10:00', duration: 75, color: '#E91E8C', status: 'bevestigd' },
    { id: 'f2', customerName: 'Merel de Wit', service: 'Knippen', time: '14:30', duration: 45, color: '#7B61FF', status: 'bevestigd' },
    { id: 'f3', customerName: 'Emma de Vries', service: 'Diepteverzorging', time: '16:00', duration: 45, color: '#9B59B6', status: 'in afwachting' },
  ],
  Za: [
    { id: 's1', customerName: 'Fleur Bakker', service: 'Balayage', time: '09:00', duration: 120, color: '#C850C0', status: 'bevestigd' },
    { id: 's2', customerName: 'Noor Hendriks', service: 'Knippen & Föhnen', time: '12:00', duration: 60, color: '#7B61FF', status: 'bevestigd' },
    { id: 's3', customerName: 'Sophie Jansen', service: 'Föhnen & Stylen', time: '15:00', duration: 30, color: '#E91E8C', status: 'bevestigd' },
    { id: 's4', customerName: 'Lisa van den Berg', service: 'Uitgroei Bijwerken', time: '16:00', duration: 60, color: '#C850C0', status: 'in afwachting' },
  ],
};

export const formatEuro = (amount: number) => 
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(amount);
