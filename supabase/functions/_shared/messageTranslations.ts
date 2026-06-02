// Default WhatsApp / SMS message templates per supported language.
// Used by edge functions when a salon has not customized their own template.
// Salon-customized templates are NEVER overwritten — they are sent as-is.

export type MessageLang = "nl" | "en" | "de" | "fr" | "es";
export const MESSAGE_LANGS: MessageLang[] = ["nl", "en", "de", "fr", "es"];
const FALLBACK: MessageLang = "nl";

export function normalizeMessageLang(input: unknown): MessageLang {
  if (typeof input !== "string") return FALLBACK;
  const short = input.toLowerCase().split("-")[0] as MessageLang;
  return (MESSAGE_LANGS as string[]).includes(short) ? short : FALLBACK;
}

type Channel = "whatsapp" | "sms";

export type MessageKey =
  // booking
  | "booking_confirmation"
  | "booking_reminder"
  | "booking_cancellation"
  | "booking_rescheduled"
  // memberships
  | "membership_confirmation"
  | "membership_reminder"
  | "membership_expiry"
  // payments
  | "payment_reminder"
  | "deposit_reminder"
  | "payment_received"
  // reviews
  | "review_request"
  | "review_followup"
  // marketing
  | "birthday"
  | "reactivation"
  | "win_back"
  // waitlist
  | "waitlist_offer"
  // generic no-show
  | "no_show";

type Bundle = Record<MessageKey, string>;

// WhatsApp = longer-form, friendly. SMS = short, no markdown.
const WA: Record<MessageLang, Bundle> = {
  nl: {
    booking_confirmation:
      `Beste {{customer_name}},\n\nHierbij bevestigen we je afspraak op {{appointment_date}} om {{appointment_time}} voor de volgende behandeling(en):\n\n{{services}}\n\nLet op: de afspraak kan kosteloos tot uiterlijk 12 uur van tevoren worden verplaatst via deze link:\n{{reschedule_link}}\n\nTot dan!\n\n{{salon_name}}`,
    booking_reminder:
      `Hi {{customer_name}} 👋\n\nHerinnering: je afspraak bij {{salon_name}} is op {{appointment_date}} om {{appointment_time}}.\n\nTot dan!`,
    booking_cancellation:
      `Hi {{customer_name}}, je afspraak op {{appointment_date}} om {{appointment_time}} bij {{salon_name}} is geannuleerd. Wil je een nieuwe afspraak inplannen? {{booking_link}}`,
    booking_rescheduled:
      `Hi {{customer_name}}, je afspraak bij {{salon_name}} is verplaatst naar {{appointment_date}} om {{appointment_time}}. Tot dan!`,
    membership_confirmation:
      `Welkom bij {{membership_name}}, {{customer_name}}! Je lidmaatschap bij {{salon_name}} is actief. Bekijk je voordelen: {{portal_link}}`,
    membership_reminder:
      `Hi {{customer_name}}, je hebt deze maand nog {{credits}} behandeling(en) tegoed via je {{membership_name}} bij {{salon_name}}. Boek snel: {{booking_link}}`,
    membership_expiry:
      `Hi {{customer_name}}, je {{membership_name}} bij {{salon_name}} loopt af op {{expiry_date}}. Verleng eenvoudig via: {{portal_link}}`,
    payment_reminder:
      `Hi {{customer_name}}, je betaling voor je afspraak bij {{salon_name}} staat nog open. Betaal eenvoudig via: {{payment_link}}`,
    deposit_reminder:
      `Hi {{customer_name}}, om je afspraak op {{appointment_date}} bij {{salon_name}} te bevestigen vragen we een aanbetaling: {{payment_link}}`,
    payment_received:
      `Bedankt {{customer_name}}! We hebben je betaling van {{amount}} ontvangen. Je afspraak bij {{salon_name}} is bevestigd.`,
    review_request:
      `Bedankt voor je bezoek aan {{salon_name}}, {{customer_name}}!\n\nWe horen graag je ervaring. Laat hier een korte review achter:\n{{review_link}}`,
    review_followup:
      `Hi {{customer_name}}, een kleine herinnering — een review helpt {{salon_name}} enorm. Bedankt alvast! {{review_link}}`,
    birthday:
      `Gefeliciteerd met je verjaardag {{customer_name}}! 🎉 {{salon_name}} trakteert: boek deze maand en ontvang een verrassing. {{booking_link}}`,
    reactivation:
      `Hi {{customer_name}}, het is alweer even geleden sinds je laatste behandeling bij {{salon_name}}. Deze week hebben we nog enkele plekken vrij. Boek: {{booking_link}}`,
    win_back:
      `Hi {{customer_name}}, we missen je bij {{salon_name}}! Speciaal voor jou: boek deze maand en ontvang een extra welkom-cadeau. {{booking_link}}`,
    waitlist_offer:
      `Hey {{customer_name}} 👋\n\nEr is net een plek vrijgekomen op {{appointment_date}} om {{appointment_time}} voor {{service}}.\n\nWil je 'm hebben? Reageer met JA, dan reserveer ik de plek voor je.\n\n– {{salon_name}}`,
    no_show:
      `Hoi {{customer_name}}, we hebben je vandaag gemist bij {{salon_name}} 💜\nGeen zorgen — we plannen graag een nieuwe afspraak in. Laat het ons weten!\n\n{{salon_name}}`,
  },
  en: {
    booking_confirmation:
      `Hi {{customer_name}},\n\nThis confirms your appointment on {{appointment_date}} at {{appointment_time}} for:\n\n{{services}}\n\nNeed to reschedule? You can do so free of charge up to 12 hours in advance:\n{{reschedule_link}}\n\nSee you then!\n\n{{salon_name}}`,
    booking_reminder:
      `Hi {{customer_name}} 👋\n\nReminder: your appointment at {{salon_name}} is on {{appointment_date}} at {{appointment_time}}.\n\nSee you soon!`,
    booking_cancellation:
      `Hi {{customer_name}}, your appointment on {{appointment_date}} at {{appointment_time}} with {{salon_name}} has been cancelled. Would you like to book a new one? {{booking_link}}`,
    booking_rescheduled:
      `Hi {{customer_name}}, your appointment at {{salon_name}} has been moved to {{appointment_date}} at {{appointment_time}}. See you then!`,
    membership_confirmation:
      `Welcome to {{membership_name}}, {{customer_name}}! Your membership at {{salon_name}} is active. View your benefits: {{portal_link}}`,
    membership_reminder:
      `Hi {{customer_name}}, you still have {{credits}} treatment(s) left this month on your {{membership_name}} at {{salon_name}}. Book now: {{booking_link}}`,
    membership_expiry:
      `Hi {{customer_name}}, your {{membership_name}} at {{salon_name}} expires on {{expiry_date}}. Renew easily here: {{portal_link}}`,
    payment_reminder:
      `Hi {{customer_name}}, your payment for your appointment at {{salon_name}} is still pending. Pay easily here: {{payment_link}}`,
    deposit_reminder:
      `Hi {{customer_name}}, to confirm your appointment on {{appointment_date}} at {{salon_name}}, we kindly ask for a deposit: {{payment_link}}`,
    payment_received:
      `Thanks {{customer_name}}! We received your payment of {{amount}}. Your appointment at {{salon_name}} is confirmed.`,
    review_request:
      `Thank you for visiting {{salon_name}}, {{customer_name}}!\n\nWe'd love to hear about your experience. Leave a quick review here:\n{{review_link}}`,
    review_followup:
      `Hi {{customer_name}}, just a small reminder — a review helps {{salon_name}} a lot. Thank you! {{review_link}}`,
    birthday:
      `Happy birthday {{customer_name}}! 🎉 {{salon_name}} is treating you — book this month and get a little surprise. {{booking_link}}`,
    reactivation:
      `Hi {{customer_name}}, it's been a while since your last treatment at {{salon_name}}. We still have a few spots this week. Book: {{booking_link}}`,
    win_back:
      `Hi {{customer_name}}, we miss you at {{salon_name}}! Just for you: book this month and get a welcome-back gift. {{booking_link}}`,
    waitlist_offer:
      `Hey {{customer_name}} 👋\n\nA spot just opened up on {{appointment_date}} at {{appointment_time}} for {{service}}.\n\nWant it? Reply YES and we'll hold it for you.\n\n– {{salon_name}}`,
    no_show:
      `Hi {{customer_name}}, we missed you today at {{salon_name}} 💜\nNo worries — happy to schedule a new appointment. Just let us know!\n\n{{salon_name}}`,
  },
  de: {
    booking_confirmation:
      `Hallo {{customer_name}},\n\nWir bestätigen Ihren Termin am {{appointment_date}} um {{appointment_time}} für:\n\n{{services}}\n\nSie können den Termin kostenfrei bis 12 Stunden vorher verschieben:\n{{reschedule_link}}\n\nBis bald!\n\n{{salon_name}}`,
    booking_reminder:
      `Hallo {{customer_name}} 👋\n\nErinnerung: Ihr Termin bei {{salon_name}} ist am {{appointment_date}} um {{appointment_time}}.\n\nBis dann!`,
    booking_cancellation:
      `Hallo {{customer_name}}, Ihr Termin am {{appointment_date}} um {{appointment_time}} bei {{salon_name}} wurde storniert. Möchten Sie einen neuen Termin buchen? {{booking_link}}`,
    booking_rescheduled:
      `Hallo {{customer_name}}, Ihr Termin bei {{salon_name}} wurde auf {{appointment_date}} um {{appointment_time}} verschoben. Bis bald!`,
    membership_confirmation:
      `Willkommen bei {{membership_name}}, {{customer_name}}! Ihre Mitgliedschaft bei {{salon_name}} ist aktiv. Vorteile ansehen: {{portal_link}}`,
    membership_reminder:
      `Hallo {{customer_name}}, Sie haben diesen Monat noch {{credits}} Behandlung(en) übrig bei Ihrem {{membership_name}}. Jetzt buchen: {{booking_link}}`,
    membership_expiry:
      `Hallo {{customer_name}}, Ihre {{membership_name}} bei {{salon_name}} läuft am {{expiry_date}} ab. Einfach verlängern: {{portal_link}}`,
    payment_reminder:
      `Hallo {{customer_name}}, Ihre Zahlung für den Termin bei {{salon_name}} ist noch offen. Hier bezahlen: {{payment_link}}`,
    deposit_reminder:
      `Hallo {{customer_name}}, zur Bestätigung Ihres Termins am {{appointment_date}} bei {{salon_name}} bitten wir um eine Anzahlung: {{payment_link}}`,
    payment_received:
      `Danke {{customer_name}}! Wir haben Ihre Zahlung über {{amount}} erhalten. Ihr Termin bei {{salon_name}} ist bestätigt.`,
    review_request:
      `Danke für Ihren Besuch bei {{salon_name}}, {{customer_name}}!\n\nWir freuen uns über Ihr Feedback. Bewertung hier hinterlassen:\n{{review_link}}`,
    review_followup:
      `Hallo {{customer_name}}, kleine Erinnerung — eine Bewertung hilft {{salon_name}} sehr. Danke! {{review_link}}`,
    birthday:
      `Alles Gute zum Geburtstag, {{customer_name}}! 🎉 {{salon_name}} lädt Sie ein: in diesem Monat buchen und eine kleine Überraschung erhalten. {{booking_link}}`,
    reactivation:
      `Hallo {{customer_name}}, Ihre letzte Behandlung bei {{salon_name}} ist eine Weile her. Diese Woche haben wir noch Plätze frei. Buchen: {{booking_link}}`,
    win_back:
      `Hallo {{customer_name}}, wir vermissen Sie bei {{salon_name}}! Speziell für Sie: in diesem Monat buchen und ein Willkommens-Geschenk erhalten. {{booking_link}}`,
    waitlist_offer:
      `Hallo {{customer_name}} 👋\n\nEs ist gerade ein Platz frei geworden am {{appointment_date}} um {{appointment_time}} für {{service}}.\n\nInteressiert? Antworten Sie mit JA, dann reservieren wir ihn.\n\n– {{salon_name}}`,
    no_show:
      `Hallo {{customer_name}}, wir haben Sie heute vermisst bei {{salon_name}} 💜\nKein Problem — wir vereinbaren gerne einen neuen Termin. Melden Sie sich!\n\n{{salon_name}}`,
  },
  fr: {
    booking_confirmation:
      `Bonjour {{customer_name}},\n\nNous confirmons votre rendez-vous le {{appointment_date}} à {{appointment_time}} pour :\n\n{{services}}\n\nVous pouvez le déplacer gratuitement jusqu'à 12 heures à l'avance :\n{{reschedule_link}}\n\nÀ bientôt !\n\n{{salon_name}}`,
    booking_reminder:
      `Bonjour {{customer_name}} 👋\n\nRappel : votre rendez-vous chez {{salon_name}} est le {{appointment_date}} à {{appointment_time}}.\n\nÀ bientôt !`,
    booking_cancellation:
      `Bonjour {{customer_name}}, votre rendez-vous le {{appointment_date}} à {{appointment_time}} chez {{salon_name}} a été annulé. Souhaitez-vous en reprendre un ? {{booking_link}}`,
    booking_rescheduled:
      `Bonjour {{customer_name}}, votre rendez-vous chez {{salon_name}} a été déplacé au {{appointment_date}} à {{appointment_time}}. À bientôt !`,
    membership_confirmation:
      `Bienvenue dans {{membership_name}}, {{customer_name}} ! Votre abonnement chez {{salon_name}} est actif. Vos avantages : {{portal_link}}`,
    membership_reminder:
      `Bonjour {{customer_name}}, il vous reste {{credits}} soin(s) ce mois-ci sur votre {{membership_name}}. Réservez : {{booking_link}}`,
    membership_expiry:
      `Bonjour {{customer_name}}, votre {{membership_name}} chez {{salon_name}} expire le {{expiry_date}}. Renouvelez ici : {{portal_link}}`,
    payment_reminder:
      `Bonjour {{customer_name}}, votre paiement pour le rendez-vous chez {{salon_name}} est en attente. Payez ici : {{payment_link}}`,
    deposit_reminder:
      `Bonjour {{customer_name}}, pour confirmer votre rendez-vous du {{appointment_date}} chez {{salon_name}}, merci de régler l'acompte : {{payment_link}}`,
    payment_received:
      `Merci {{customer_name}} ! Nous avons reçu votre paiement de {{amount}}. Votre rendez-vous chez {{salon_name}} est confirmé.`,
    review_request:
      `Merci pour votre visite chez {{salon_name}}, {{customer_name}} !\n\nVotre avis nous intéresse. Laissez-en un ici :\n{{review_link}}`,
    review_followup:
      `Bonjour {{customer_name}}, petit rappel — un avis aide énormément {{salon_name}}. Merci ! {{review_link}}`,
    birthday:
      `Joyeux anniversaire {{customer_name}} ! 🎉 {{salon_name}} vous gâte : réservez ce mois-ci et profitez d'une petite surprise. {{booking_link}}`,
    reactivation:
      `Bonjour {{customer_name}}, cela fait un moment depuis votre dernier soin chez {{salon_name}}. Quelques créneaux sont encore libres cette semaine. Réservez : {{booking_link}}`,
    win_back:
      `Bonjour {{customer_name}}, vous nous manquez chez {{salon_name}} ! Pour vous : réservez ce mois-ci et recevez un cadeau de bienvenue. {{booking_link}}`,
    waitlist_offer:
      `Bonjour {{customer_name}} 👋\n\nUn créneau vient de se libérer le {{appointment_date}} à {{appointment_time}} pour {{service}}.\n\nIntéressé ? Répondez OUI et nous le réservons pour vous.\n\n– {{salon_name}}`,
    no_show:
      `Bonjour {{customer_name}}, nous vous avons manqué aujourd'hui chez {{salon_name}} 💜\nPas de souci — nous serions ravis de reprogrammer. Faites-nous signe !\n\n{{salon_name}}`,
  },
  es: {
    booking_confirmation:
      `Hola {{customer_name}},\n\nConfirmamos tu cita el {{appointment_date}} a las {{appointment_time}} para:\n\n{{services}}\n\nPuedes moverla gratis hasta 12 horas antes:\n{{reschedule_link}}\n\n¡Hasta pronto!\n\n{{salon_name}}`,
    booking_reminder:
      `Hola {{customer_name}} 👋\n\nRecordatorio: tu cita en {{salon_name}} es el {{appointment_date}} a las {{appointment_time}}.\n\n¡Hasta pronto!`,
    booking_cancellation:
      `Hola {{customer_name}}, tu cita del {{appointment_date}} a las {{appointment_time}} en {{salon_name}} ha sido cancelada. ¿Quieres reservar una nueva? {{booking_link}}`,
    booking_rescheduled:
      `Hola {{customer_name}}, tu cita en {{salon_name}} se ha movido al {{appointment_date}} a las {{appointment_time}}. ¡Hasta pronto!`,
    membership_confirmation:
      `¡Bienvenido a {{membership_name}}, {{customer_name}}! Tu membresía en {{salon_name}} está activa. Ver beneficios: {{portal_link}}`,
    membership_reminder:
      `Hola {{customer_name}}, te quedan {{credits}} tratamiento(s) este mes en tu {{membership_name}}. Reserva: {{booking_link}}`,
    membership_expiry:
      `Hola {{customer_name}}, tu {{membership_name}} en {{salon_name}} caduca el {{expiry_date}}. Renueva fácilmente: {{portal_link}}`,
    payment_reminder:
      `Hola {{customer_name}}, tu pago para la cita en {{salon_name}} está pendiente. Paga aquí: {{payment_link}}`,
    deposit_reminder:
      `Hola {{customer_name}}, para confirmar tu cita del {{appointment_date}} en {{salon_name}}, te pedimos un depósito: {{payment_link}}`,
    payment_received:
      `¡Gracias {{customer_name}}! Hemos recibido tu pago de {{amount}}. Tu cita en {{salon_name}} está confirmada.`,
    review_request:
      `¡Gracias por tu visita a {{salon_name}}, {{customer_name}}!\n\nNos encantaría escuchar tu experiencia. Déjanos una reseña:\n{{review_link}}`,
    review_followup:
      `Hola {{customer_name}}, un pequeño recordatorio — una reseña ayuda mucho a {{salon_name}}. ¡Gracias! {{review_link}}`,
    birthday:
      `¡Feliz cumpleaños {{customer_name}}! 🎉 {{salon_name}} te invita: reserva este mes y recibe una sorpresa. {{booking_link}}`,
    reactivation:
      `Hola {{customer_name}}, hace tiempo desde tu último tratamiento en {{salon_name}}. Aún tenemos huecos esta semana. Reserva: {{booking_link}}`,
    win_back:
      `Hola {{customer_name}}, ¡te echamos de menos en {{salon_name}}! Especial para ti: reserva este mes y recibe un regalo de bienvenida. {{booking_link}}`,
    waitlist_offer:
      `Hola {{customer_name}} 👋\n\nSe ha liberado un hueco el {{appointment_date}} a las {{appointment_time}} para {{service}}.\n\n¿Lo quieres? Responde SÍ y te lo reservamos.\n\n– {{salon_name}}`,
    no_show:
      `Hola {{customer_name}}, te echamos de menos hoy en {{salon_name}} 💜\nSin problema — podemos reprogramar. ¡Avísanos!\n\n{{salon_name}}`,
  },
};

// SMS variants — shorter, plain text, no emoji-heavy formatting, single paragraph.
const SMS: Record<MessageLang, Bundle> = {
  nl: {
    booking_confirmation: `Bevestigd: afspraak {{appointment_date}} {{appointment_time}} bij {{salon_name}}. Verzetten: {{reschedule_link}}`,
    booking_reminder: `Herinnering: afspraak bij {{salon_name}} op {{appointment_date}} om {{appointment_time}}.`,
    booking_cancellation: `Je afspraak op {{appointment_date}} bij {{salon_name}} is geannuleerd. Nieuwe boeking: {{booking_link}}`,
    booking_rescheduled: `Je afspraak bij {{salon_name}} is verplaatst naar {{appointment_date}} {{appointment_time}}.`,
    membership_confirmation: `Welkom bij {{membership_name}}. Beheer: {{portal_link}}`,
    membership_reminder: `Nog {{credits}} behandeling(en) tegoed deze maand bij {{salon_name}}. Boek: {{booking_link}}`,
    membership_expiry: `Je {{membership_name}} loopt af op {{expiry_date}}. Verleng: {{portal_link}}`,
    payment_reminder: `Betaling open voor afspraak bij {{salon_name}}: {{payment_link}}`,
    deposit_reminder: `Aanbetaling vereist voor je afspraak {{appointment_date}}: {{payment_link}}`,
    payment_received: `Bedankt, betaling van {{amount}} ontvangen. Afspraak bij {{salon_name}} bevestigd.`,
    review_request: `Bedankt voor je bezoek aan {{salon_name}}! Review: {{review_link}}`,
    review_followup: `Korte herinnering: een review helpt {{salon_name}} enorm. {{review_link}}`,
    birthday: `Gefeliciteerd {{customer_name}}! Boek deze maand bij {{salon_name}}: {{booking_link}}`,
    reactivation: `Tijd voor een nieuwe afspraak bij {{salon_name}}? Boek: {{booking_link}}`,
    win_back: `We missen je bij {{salon_name}}! Boek deze maand: {{booking_link}}`,
    waitlist_offer: `Plek vrij: {{appointment_date}} {{appointment_time}} {{service}}. Antwoord JA om te reserveren.`,
    no_show: `We hebben je gemist vandaag bij {{salon_name}}. Nieuwe afspraak? {{booking_link}}`,
  },
  en: {
    booking_confirmation: `Confirmed: appointment {{appointment_date}} {{appointment_time}} at {{salon_name}}. Reschedule: {{reschedule_link}}`,
    booking_reminder: `Reminder: appointment at {{salon_name}} on {{appointment_date}} at {{appointment_time}}.`,
    booking_cancellation: `Your appointment on {{appointment_date}} at {{salon_name}} was cancelled. Rebook: {{booking_link}}`,
    booking_rescheduled: `Your appointment at {{salon_name}} was moved to {{appointment_date}} {{appointment_time}}.`,
    membership_confirmation: `Welcome to {{membership_name}}. Manage: {{portal_link}}`,
    membership_reminder: `{{credits}} treatment(s) left this month at {{salon_name}}. Book: {{booking_link}}`,
    membership_expiry: `Your {{membership_name}} ends on {{expiry_date}}. Renew: {{portal_link}}`,
    payment_reminder: `Payment pending for your appointment at {{salon_name}}: {{payment_link}}`,
    deposit_reminder: `Deposit needed for your appointment {{appointment_date}}: {{payment_link}}`,
    payment_received: `Thanks, payment of {{amount}} received. Appointment at {{salon_name}} confirmed.`,
    review_request: `Thanks for visiting {{salon_name}}! Review: {{review_link}}`,
    review_followup: `Quick reminder: a review helps {{salon_name}} a lot. {{review_link}}`,
    birthday: `Happy birthday {{customer_name}}! Book this month at {{salon_name}}: {{booking_link}}`,
    reactivation: `Time for a new appointment at {{salon_name}}? Book: {{booking_link}}`,
    win_back: `We miss you at {{salon_name}}! Book this month: {{booking_link}}`,
    waitlist_offer: `Slot open: {{appointment_date}} {{appointment_time}} {{service}}. Reply YES to grab it.`,
    no_show: `We missed you today at {{salon_name}}. New appointment? {{booking_link}}`,
  },
  de: {
    booking_confirmation: `Bestätigt: Termin {{appointment_date}} {{appointment_time}} bei {{salon_name}}. Verschieben: {{reschedule_link}}`,
    booking_reminder: `Erinnerung: Termin bei {{salon_name}} am {{appointment_date}} um {{appointment_time}}.`,
    booking_cancellation: `Ihr Termin am {{appointment_date}} bei {{salon_name}} wurde storniert. Neu buchen: {{booking_link}}`,
    booking_rescheduled: `Ihr Termin bei {{salon_name}} wurde verschoben auf {{appointment_date}} {{appointment_time}}.`,
    membership_confirmation: `Willkommen bei {{membership_name}}. Verwalten: {{portal_link}}`,
    membership_reminder: `{{credits}} Behandlung(en) übrig diesen Monat bei {{salon_name}}. Buchen: {{booking_link}}`,
    membership_expiry: `Ihre {{membership_name}} endet am {{expiry_date}}. Verlängern: {{portal_link}}`,
    payment_reminder: `Zahlung offen für Ihren Termin bei {{salon_name}}: {{payment_link}}`,
    deposit_reminder: `Anzahlung nötig für Ihren Termin {{appointment_date}}: {{payment_link}}`,
    payment_received: `Danke, Zahlung über {{amount}} erhalten. Termin bei {{salon_name}} bestätigt.`,
    review_request: `Danke für Ihren Besuch bei {{salon_name}}! Bewertung: {{review_link}}`,
    review_followup: `Kurze Erinnerung: Eine Bewertung hilft {{salon_name}} sehr. {{review_link}}`,
    birthday: `Alles Gute {{customer_name}}! Diesen Monat bei {{salon_name}} buchen: {{booking_link}}`,
    reactivation: `Zeit für einen neuen Termin bei {{salon_name}}? Buchen: {{booking_link}}`,
    win_back: `Wir vermissen Sie bei {{salon_name}}! Diesen Monat buchen: {{booking_link}}`,
    waitlist_offer: `Platz frei: {{appointment_date}} {{appointment_time}} {{service}}. Antworten Sie mit JA.`,
    no_show: `Wir haben Sie heute vermisst bei {{salon_name}}. Neuer Termin? {{booking_link}}`,
  },
  fr: {
    booking_confirmation: `Confirmé : RDV {{appointment_date}} {{appointment_time}} chez {{salon_name}}. Déplacer : {{reschedule_link}}`,
    booking_reminder: `Rappel : RDV chez {{salon_name}} le {{appointment_date}} à {{appointment_time}}.`,
    booking_cancellation: `Votre RDV du {{appointment_date}} chez {{salon_name}} est annulé. Reprendre : {{booking_link}}`,
    booking_rescheduled: `Votre RDV chez {{salon_name}} a été déplacé au {{appointment_date}} {{appointment_time}}.`,
    membership_confirmation: `Bienvenue dans {{membership_name}}. Gérer : {{portal_link}}`,
    membership_reminder: `{{credits}} soin(s) restant(s) ce mois chez {{salon_name}}. Réserver : {{booking_link}}`,
    membership_expiry: `Votre {{membership_name}} expire le {{expiry_date}}. Renouveler : {{portal_link}}`,
    payment_reminder: `Paiement en attente pour votre RDV chez {{salon_name}} : {{payment_link}}`,
    deposit_reminder: `Acompte requis pour votre RDV du {{appointment_date}} : {{payment_link}}`,
    payment_received: `Merci, paiement de {{amount}} reçu. RDV chez {{salon_name}} confirmé.`,
    review_request: `Merci pour votre visite chez {{salon_name}} ! Avis : {{review_link}}`,
    review_followup: `Petit rappel : un avis aide beaucoup {{salon_name}}. {{review_link}}`,
    birthday: `Joyeux anniversaire {{customer_name}} ! Réservez ce mois chez {{salon_name}} : {{booking_link}}`,
    reactivation: `Un nouveau RDV chez {{salon_name}} ? Réserver : {{booking_link}}`,
    win_back: `Vous nous manquez chez {{salon_name}} ! Réservez ce mois : {{booking_link}}`,
    waitlist_offer: `Créneau libre : {{appointment_date}} {{appointment_time}} {{service}}. Répondez OUI.`,
    no_show: `Nous vous avons manqué aujourd'hui chez {{salon_name}}. Nouveau RDV ? {{booking_link}}`,
  },
  es: {
    booking_confirmation: `Confirmado: cita {{appointment_date}} {{appointment_time}} en {{salon_name}}. Mover: {{reschedule_link}}`,
    booking_reminder: `Recordatorio: cita en {{salon_name}} el {{appointment_date}} a las {{appointment_time}}.`,
    booking_cancellation: `Tu cita del {{appointment_date}} en {{salon_name}} fue cancelada. Reservar: {{booking_link}}`,
    booking_rescheduled: `Tu cita en {{salon_name}} se movió al {{appointment_date}} {{appointment_time}}.`,
    membership_confirmation: `Bienvenido a {{membership_name}}. Gestionar: {{portal_link}}`,
    membership_reminder: `{{credits}} tratamiento(s) este mes en {{salon_name}}. Reservar: {{booking_link}}`,
    membership_expiry: `Tu {{membership_name}} caduca el {{expiry_date}}. Renovar: {{portal_link}}`,
    payment_reminder: `Pago pendiente para tu cita en {{salon_name}}: {{payment_link}}`,
    deposit_reminder: `Depósito necesario para tu cita {{appointment_date}}: {{payment_link}}`,
    payment_received: `Gracias, pago de {{amount}} recibido. Cita en {{salon_name}} confirmada.`,
    review_request: `¡Gracias por tu visita a {{salon_name}}! Reseña: {{review_link}}`,
    review_followup: `Pequeño recordatorio: una reseña ayuda mucho a {{salon_name}}. {{review_link}}`,
    birthday: `¡Feliz cumpleaños {{customer_name}}! Reserva este mes en {{salon_name}}: {{booking_link}}`,
    reactivation: `¿Tiempo para otra cita en {{salon_name}}? Reserva: {{booking_link}}`,
    win_back: `¡Te echamos de menos en {{salon_name}}! Reserva este mes: {{booking_link}}`,
    waitlist_offer: `Hueco libre: {{appointment_date}} {{appointment_time}} {{service}}. Responde SÍ.`,
    no_show: `Te echamos de menos hoy en {{salon_name}}. ¿Nueva cita? {{booking_link}}`,
  },
};

/**
 * Get the default template for a given message key, language and channel.
 * Falls back to Dutch if the language is unsupported or the key is missing.
 */
export function getDefaultMessageTemplate(
  key: MessageKey,
  lang: unknown,
  channel: Channel = "whatsapp",
): string {
  const l = normalizeMessageLang(lang);
  const bundle = (channel === "sms" ? SMS : WA)[l] ?? (channel === "sms" ? SMS[FALLBACK] : WA[FALLBACK]);
  return bundle[key] ?? (channel === "sms" ? SMS[FALLBACK][key] : WA[FALLBACK][key]);
}

/** Render placeholder substitution. Supports `{{ key }}` with surrounding whitespace. */
export function renderMessage(template: string, vars: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
    const v = vars[k];
    return v === null || v === undefined ? "" : String(v);
  });
}

/** Locale code for Intl formatting. */
export function intlLocale(lang: unknown): string {
  const l = normalizeMessageLang(lang);
  return ({ nl: "nl-NL", en: "en-GB", de: "de-DE", fr: "fr-FR", es: "es-ES" } as const)[l];
}

/** Resolve the customer's preferred language. Falls back to settings.language then to Dutch. */
export async function resolveCustomerLanguage(
  admin: any,
  opts: { user_id: string; customer_id?: string | null; email?: string | null; explicit?: string | null; settings_language?: string | null },
): Promise<MessageLang> {
  if (opts.explicit) return normalizeMessageLang(opts.explicit);
  try {
    if (opts.customer_id) {
      const { data } = await admin
        .from("customers")
        .select("preferred_language")
        .eq("id", opts.customer_id)
        .maybeSingle();
      if (data?.preferred_language) return normalizeMessageLang(data.preferred_language);
    } else if (opts.email) {
      const { data } = await admin
        .from("customers")
        .select("preferred_language")
        .eq("user_id", opts.user_id)
        .eq("email", opts.email.toLowerCase())
        .maybeSingle();
      if (data?.preferred_language) return normalizeMessageLang(data.preferred_language);
    }
  } catch { /* noop */ }
  return normalizeMessageLang(opts.settings_language || "nl");
}
