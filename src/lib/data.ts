// Dummy data for GlowSuite

export interface Appointment {
  id: string;
  customerName: string;
  service: string;
  time: string;
  duration: number; // minutes
  color: string;
  status: 'confirmed' | 'pending' | 'completed';
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

export const todaysAppointments: Appointment[] = [
  { id: '1', customerName: 'Emma Richards', service: 'Balayage', time: '09:00', duration: 120, color: '#7B61FF', status: 'confirmed' },
  { id: '2', customerName: 'Sofia Chen', service: 'Haircut & Blowdry', time: '10:30', duration: 60, color: '#C850C0', status: 'confirmed' },
  { id: '3', customerName: 'Olivia Park', service: 'Keratin Treatment', time: '12:00', duration: 90, color: '#7B61FF', status: 'pending' },
  { id: '4', customerName: 'Mia Torres', service: 'Root Touch-up', time: '14:00', duration: 60, color: '#C850C0', status: 'confirmed' },
  { id: '5', customerName: 'Ava Nakamura', service: 'Haircut', time: '15:30', duration: 45, color: '#7B61FF', status: 'confirmed' },
  { id: '6', customerName: 'Isabella Rossi', service: 'Deep Conditioning', time: '17:00', duration: 45, color: '#C850C0', status: 'pending' },
];

export const customers: Customer[] = [
  { id: '1', name: 'Emma Richards', phone: '+1 (415) 555-0142', email: 'emma.r@mail.com', totalVisits: 24, totalSpent: 3240, lastVisit: '2026-03-19', initials: 'ER' },
  { id: '2', name: 'Sofia Chen', phone: '+1 (415) 555-0198', email: 'sofia.chen@mail.com', totalVisits: 18, totalSpent: 2100, lastVisit: '2026-03-21', initials: 'SC' },
  { id: '3', name: 'Olivia Park', phone: '+1 (415) 555-0256', email: 'olivia.p@mail.com', totalVisits: 12, totalSpent: 1890, lastVisit: '2026-03-15', initials: 'OP' },
  { id: '4', name: 'Mia Torres', phone: '+1 (415) 555-0311', email: 'mia.t@mail.com', totalVisits: 31, totalSpent: 4520, lastVisit: '2026-03-20', initials: 'MT' },
  { id: '5', name: 'Ava Nakamura', phone: '+1 (415) 555-0389', email: 'ava.n@mail.com', totalVisits: 8, totalSpent: 960, lastVisit: '2026-03-10', initials: 'AN' },
  { id: '6', name: 'Isabella Rossi', phone: '+1 (415) 555-0427', email: 'isabella.r@mail.com', totalVisits: 15, totalSpent: 2340, lastVisit: '2026-03-18', initials: 'IR' },
  { id: '7', name: 'Charlotte Webb', phone: '+1 (415) 555-0501', email: 'charlotte.w@mail.com', totalVisits: 6, totalSpent: 720, lastVisit: '2026-02-28', initials: 'CW' },
  { id: '8', name: 'Amelia Zhang', phone: '+1 (415) 555-0563', email: 'amelia.z@mail.com', totalVisits: 22, totalSpent: 3100, lastVisit: '2026-03-17', initials: 'AZ' },
];

export const services: Service[] = [
  { id: '1', name: 'Haircut', duration: 45, price: 65, category: 'Hair', color: '#7B61FF' },
  { id: '2', name: 'Haircut & Blowdry', duration: 60, price: 85, category: 'Hair', color: '#7B61FF' },
  { id: '3', name: 'Balayage', duration: 120, price: 180, category: 'Color', color: '#C850C0' },
  { id: '4', name: 'Root Touch-up', duration: 60, price: 95, category: 'Color', color: '#C850C0' },
  { id: '5', name: 'Keratin Treatment', duration: 90, price: 150, category: 'Treatment', color: '#9B59B6' },
  { id: '6', name: 'Deep Conditioning', duration: 45, price: 55, category: 'Treatment', color: '#9B59B6' },
  { id: '7', name: 'Blowdry & Style', duration: 30, price: 45, category: 'Styling', color: '#E91E8C' },
  { id: '8', name: 'Updo / Event Hair', duration: 75, price: 120, category: 'Styling', color: '#E91E8C' },
];

export const aiSuggestions: AISuggestion[] = [
  { id: '1', icon: '📅', title: '3 empty slots tomorrow', description: 'Tuesday 10:00, 13:00, and 16:00 are open. Consider sending a promo to recent clients.', action: 'Fill Slots', priority: 'high' },
  { id: '2', icon: '💌', title: 'Re-engage inactive clients', description: '4 clients haven't visited in 30+ days. Send them a personalized reminder.', action: 'Send Reminders', priority: 'high' },
  { id: '3', icon: '💰', title: 'Revenue opportunity', description: 'Charlotte W. usually books a treatment add-on. Suggest it at her next visit.', action: 'Note Added', priority: 'medium' },
  { id: '4', icon: '⭐', title: 'Review request ready', description: '3 clients completed services yesterday. Ask them for a Google review.', action: 'Send Requests', priority: 'low' },
];

export const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const timeSlots = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00'];

export const weekAppointments: Record<string, Appointment[]> = {
  Mon: todaysAppointments,
  Tue: [
    { id: 't1', customerName: 'Amelia Zhang', service: 'Haircut & Blowdry', time: '09:30', duration: 60, color: '#C850C0', status: 'confirmed' },
    { id: 't2', customerName: 'Charlotte Webb', service: 'Deep Conditioning', time: '14:00', duration: 45, color: '#9B59B6', status: 'confirmed' },
  ],
  Wed: [
    { id: 'w1', customerName: 'Emma Richards', service: 'Root Touch-up', time: '10:00', duration: 60, color: '#C850C0', status: 'confirmed' },
    { id: 'w2', customerName: 'Mia Torres', service: 'Blowdry & Style', time: '11:30', duration: 30, color: '#E91E8C', status: 'confirmed' },
    { id: 'w3', customerName: 'Sofia Chen', service: 'Keratin Treatment', time: '14:00', duration: 90, color: '#9B59B6', status: 'pending' },
  ],
  Thu: [
    { id: 'th1', customerName: 'Olivia Park', service: 'Haircut', time: '09:00', duration: 45, color: '#7B61FF', status: 'confirmed' },
    { id: 'th2', customerName: 'Ava Nakamura', service: 'Balayage', time: '13:00', duration: 120, color: '#C850C0', status: 'confirmed' },
  ],
  Fri: [
    { id: 'f1', customerName: 'Isabella Rossi', service: 'Updo / Event Hair', time: '10:00', duration: 75, color: '#E91E8C', status: 'confirmed' },
    { id: 'f2', customerName: 'Amelia Zhang', service: 'Haircut', time: '14:30', duration: 45, color: '#7B61FF', status: 'confirmed' },
    { id: 'f3', customerName: 'Emma Richards', service: 'Deep Conditioning', time: '16:00', duration: 45, color: '#9B59B6', status: 'pending' },
  ],
  Sat: [
    { id: 's1', customerName: 'Mia Torres', service: 'Balayage', time: '09:00', duration: 120, color: '#C850C0', status: 'confirmed' },
    { id: 's2', customerName: 'Charlotte Webb', service: 'Haircut & Blowdry', time: '12:00', duration: 60, color: '#7B61FF', status: 'confirmed' },
    { id: 's3', customerName: 'Sofia Chen', service: 'Blowdry & Style', time: '15:00', duration: 30, color: '#E91E8C', status: 'confirmed' },
    { id: 's4', customerName: 'Olivia Park', service: 'Root Touch-up', time: '16:00', duration: 60, color: '#C850C0', status: 'pending' },
  ],
};
