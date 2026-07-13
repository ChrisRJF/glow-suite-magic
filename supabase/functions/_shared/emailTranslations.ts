// Shared customer-email translation dictionary for salon → customer emails.
// Used by send-white-label-email. Salon-created content (service names, staff
// names, salon name, membership names, gift card names) is NEVER translated.
// Keys here only cover platform-level "chrome": subjects, headings, intros,
// labels, CTAs, helper text and footer notices.

export type EmailLang = "nl" | "en" | "de" | "fr" | "es";

const SUPPORTED: EmailLang[] = ["nl", "en", "de", "fr", "es"];

export function normalizeEmailLang(value: unknown): EmailLang {
  if (typeof value !== "string") return "nl";
  const short = value.toLowerCase().split("-")[0] as EmailLang;
  return (SUPPORTED as string[]).includes(short) ? short : "nl";
}

const LOCALE_TAG: Record<EmailLang, string> = {
  nl: "nl-NL",
  en: "en-GB",
  de: "de-DE",
  fr: "fr-FR",
  es: "es-ES",
};

export function formatDateLong(value: unknown, lang: EmailLang): string {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(LOCALE_TAG[lang], {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function formatDateShort(value: unknown, lang: EmailLang): string {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(LOCALE_TAG[lang], {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function formatCurrency(value: unknown, lang: EmailLang): string {
  const amount = Number(value || 0);
  return new Intl.NumberFormat(LOCALE_TAG[lang], { style: "currency", currency: "EUR" }).format(amount);
}

interface TplStrings {
  booking_confirmation: {
    subject: (salon: string, date: string) => string;
    subject_no_date: (salon: string) => string;
    title: string;
    intro_named: (first: string, salon: string) => string;
    intro: (salon: string) => string;
    cta_manage: string;
    cta_route: string;
    cta_calendar: string;
    note_title: string;
    note_1: string;
    note_2: string;
    terms_line: (link: string) => string;
  };
  payment_receipt: {
    subject: (salon: string, ref: string) => string;
    title: string;
    intro: (salon: string) => string;
    cta_receipt: string;
    cta_appointment: string;
    total_label: string;
    vat_line: (vat: string, rate: string) => string;
    vat_no_rate: (vat: string) => string;
  };
  appointment_reminder: {
    subject: (salon: string, date: string) => string;
    title: string;
    intro_named: (first: string, salon: string) => string;
    intro: (salon: string) => string;
    cta_manage: string;
    cta_route: string;
    cta_calendar: string;
    cta_confirm: string;
    cta_decline: string;
    confirm_intro: string;
    note_title: string;
    note_default_tip: string;
    note_reschedule: string;
  };
  booking_cancellation: {
    subject: (salon: string) => string;
    title: string;
    intro: (salon: string) => string;
    status_cancelled: string;
    cta_new: string;
    cta_route: string;
    note_title: string;
    note_check: string;
    note_contact: (email: string) => string;
    note_help: string;
  };
  membership_notification: {
    subject: (salon: string) => string;
    title: string;
    intro_named: (first: string, salon: string) => string;
    intro: (salon: string) => string;
    cta_manage: string;
    cta_book: string;
    status_active: string;
    benefits_title: string;
  };
  review_request: {
    subject: (salon: string) => string;
    title: string;
    intro_named: (first: string, salon: string) => string;
    intro: (salon: string) => string;
    body_text: string;
    cta_review: string;
    cta_rebook: string;
  };
  // shared / rows / footer
  shared: {
    row_customer: string;
    row_date: string;
    row_time: string;
    row_service: string;
    row_staff: string;
    row_location: string;
    row_reference: string;
    row_total: string;
    row_status: string;
    row_method: string;
    row_description: string;
    row_vat: string;
    row_vat_active: string;
    row_membership: string;
    row_credits: string;
    row_next_payment: string;
    row_monthly: string;
    row_support: string;
    footer: (salon: string) => string;
    fallback_link_prefix: string;
  };
}

const NL: TplStrings = {
  booking_confirmation: {
    subject: (s, d) => `${s} · je afspraak op ${d}`,
    subject_no_date: (s) => `${s} · je afspraak is bevestigd`,
    title: "Je afspraak staat klaar",
    intro_named: (f, s) => `${f}, je behandeling bij ${s} is bevestigd. We kijken ernaar uit je te ontvangen.`,
    intro: (s) => `Je behandeling bij ${s} is bevestigd. We kijken ernaar uit je te ontvangen.`,
    cta_manage: "Afspraak beheren",
    cta_route: "Route bekijken",
    cta_calendar: "Toevoegen aan agenda",
    note_title: "Handig om te weten",
    note_1: "Zet je afspraak direct in je agenda.",
    note_2: "Kun je niet komen? Beheer je afspraak op tijd.",
    terms_line: (l) => `Op deze afspraak gelden de <a href="${l}">salonvoorwaarden</a>.`,
  },
  payment_receipt: {
    subject: (s, r) => `${s} · betaalbewijs${r ? ` #${r}` : ""}`,
    title: "Je betaalbewijs",
    intro: (s) => `Dank je wel. Je betaling aan ${s} is veilig verwerkt.`,
    cta_receipt: "Bekijk betaalbewijs",
    cta_appointment: "Afspraak bekijken",
    total_label: "Totaal betaald",
    vat_line: (v, r) => `Inclusief BTW (${r}%): ${v}`,
    vat_no_rate: (v) => `Inclusief BTW: ${v}`,
  },
  appointment_reminder: {
    subject: (s, d) => `${s} · herinnering voor ${d}`,
    title: "Tot snel bij je afspraak",
    intro_named: (f, s) => `${f}, dit is een vriendelijke herinnering aan je afspraak bij ${s}.`,
    intro: (s) => `Dit is een vriendelijke herinnering aan je afspraak bij ${s}.`,
    cta_manage: "Afspraak beheren",
    cta_route: "Route bekijken",
    cta_calendar: "Toevoegen aan kalender",
    cta_confirm: "Ja, ik kom",
    cta_decline: "Nee, ik kan niet komen",
    confirm_intro: "Laat je ons weten of je komt?",
    note_title: "Voor je afspraak",
    note_default_tip: "Kom liefst een paar minuten op tijd.",
    note_reschedule: "Ben je verhinderd? Beheer je afspraak op tijd.",
  },
  booking_cancellation: {
    subject: (s) => `${s} · annulering bevestigd`,
    title: "Je afspraak is geannuleerd",
    intro: (s) => `We bevestigen dat je afspraak bij ${s} is geannuleerd. Je bent altijd welkom om een nieuw moment te kiezen.`,
    status_cancelled: "Geannuleerd",
    cta_new: "Nieuwe afspraak maken",
    cta_route: "Route bekijken",
    note_title: "Hulp nodig?",
    note_check: "Neem gerust contact op als dit niet klopt.",
    note_contact: (e) => `Je kunt ons bereiken via ${e}.`,
    note_help: "Ons team helpt je graag met het plannen van een nieuw moment.",
  },
  membership_notification: {
    subject: (s) => `${s} · welkom bij je abonnement`,
    title: "Welkom bij je abonnement",
    intro_named: (f, s) => `${f}, welkom bij je abonnement van ${s}. Je voordelen staan voor je klaar.`,
    intro: (s) => `Welkom bij je abonnement van ${s}. Je voordelen staan voor je klaar.`,
    cta_manage: "Abonnement beheren",
    cta_book: "Nieuwe afspraak boeken",
    status_active: "Actief",
    benefits_title: "Jouw voordelen",
  },
  review_request: {
    subject: (s) => `${s} · hoe was je ervaring?`,
    title: "Dank je wel voor je bezoek",
    intro_named: (f, s) => `${f}, bedankt voor je bezoek aan ${s}. We hopen dat je tevreden bent met je behandeling.`,
    intro: (s) => `Bedankt voor je bezoek aan ${s}. We hopen dat je tevreden bent met je behandeling.`,
    body_text: "Met je review help je ons de salonervaring nog beter te maken. Ook help je nieuwe klanten kiezen met vertrouwen.",
    cta_review: "Review schrijven",
    cta_rebook: "Nieuwe afspraak boeken",
  },
  shared: {
    row_customer: "Klant",
    row_date: "Datum",
    row_time: "Tijd",
    row_service: "Behandeling",
    row_staff: "Medewerker",
    row_location: "Locatie",
    row_reference: "Referentie",
    row_total: "Totaal",
    row_status: "Status",
    row_method: "Betaalmethode",
    row_description: "Omschrijving",
    row_vat: "BTW",
    row_vat_active: "Actief",
    row_membership: "Abonnement",
    row_credits: "Credits",
    row_next_payment: "Volgende incasso",
    row_monthly: "Maandbedrag",
    row_support: "Support",
    footer: (s) => `Verzonden door ${s} via GlowSuite. Dit is een servicebericht over je afspraak, betaling of abonnement.`,
    fallback_link_prefix: "Werkt de knop niet? Kopieer deze link:",
  },
};

const EN: TplStrings = {
  booking_confirmation: {
    subject: (s, d) => `${s} · your appointment on ${d}`,
    subject_no_date: (s) => `${s} · your appointment is confirmed`,
    title: "Your appointment is set",
    intro_named: (f, s) => `${f}, your treatment at ${s} is confirmed. We look forward to seeing you.`,
    intro: (s) => `Your treatment at ${s} is confirmed. We look forward to seeing you.`,
    cta_manage: "Manage appointment",
    cta_route: "View directions",
    cta_calendar: "Add to calendar",
    note_title: "Good to know",
    note_1: "Add your appointment to your calendar.",
    note_2: "Can't make it? Manage your appointment in time.",
    terms_line: (l) => `This appointment is subject to the <a href="${l}">salon terms</a>.`,
  },
  payment_receipt: {
    subject: (s, r) => `${s} · payment receipt${r ? ` #${r}` : ""}`,
    title: "Your payment receipt",
    intro: (s) => `Thank you. Your payment to ${s} was processed securely.`,
    cta_receipt: "View receipt",
    cta_appointment: "View appointment",
    total_label: "Total paid",
    vat_line: (v, r) => `Including VAT (${r}%): ${v}`,
    vat_no_rate: (v) => `Including VAT: ${v}`,
  },
  appointment_reminder: {
    subject: (s, d) => `${s} · reminder for ${d}`,
    title: "See you soon",
    intro_named: (f, s) => `${f}, this is a friendly reminder about your appointment at ${s}.`,
    intro: (s) => `This is a friendly reminder about your appointment at ${s}.`,
    cta_manage: "Manage appointment",
    cta_route: "View directions",
    cta_calendar: "Add to calendar",
    note_title: "Before your appointment",
    note_default_tip: "Please arrive a few minutes early.",
    note_reschedule: "Can't make it? Manage your appointment in time.",
  },
  booking_cancellation: {
    subject: (s) => `${s} · cancellation confirmed`,
    title: "Your appointment was cancelled",
    intro: (s) => `We confirm that your appointment at ${s} has been cancelled. You're welcome to book another moment any time.`,
    status_cancelled: "Cancelled",
    cta_new: "Book new appointment",
    cta_route: "View directions",
    note_title: "Need help?",
    note_check: "Please get in touch if this is not correct.",
    note_contact: (e) => `You can reach us at ${e}.`,
    note_help: "Our team is happy to help you book a new moment.",
  },
  membership_notification: {
    subject: (s) => `${s} · welcome to your membership`,
    title: "Welcome to your membership",
    intro_named: (f, s) => `${f}, welcome to your membership at ${s}. Your benefits are ready.`,
    intro: (s) => `Welcome to your membership at ${s}. Your benefits are ready.`,
    cta_manage: "Manage membership",
    cta_book: "Book new appointment",
    status_active: "Active",
    benefits_title: "Your benefits",
  },
  review_request: {
    subject: (s) => `${s} · how was your visit?`,
    title: "Thank you for visiting",
    intro_named: (f, s) => `${f}, thank you for visiting ${s}. We hope you're happy with your treatment.`,
    intro: (s) => `Thank you for visiting ${s}. We hope you're happy with your treatment.`,
    body_text: "Your review helps us improve the salon experience and helps new clients choose with confidence.",
    cta_review: "Write a review",
    cta_rebook: "Book new appointment",
  },
  shared: {
    row_customer: "Customer",
    row_date: "Date",
    row_time: "Time",
    row_service: "Treatment",
    row_staff: "Staff",
    row_location: "Location",
    row_reference: "Reference",
    row_total: "Total",
    row_status: "Status",
    row_method: "Payment method",
    row_description: "Description",
    row_vat: "VAT",
    row_vat_active: "Active",
    row_membership: "Membership",
    row_credits: "Credits",
    row_next_payment: "Next payment",
    row_monthly: "Monthly amount",
    row_support: "Support",
    footer: (s) => `Sent by ${s} via GlowSuite. This is a service message about your appointment, payment or membership.`,
    fallback_link_prefix: "Button not working? Copy this link:",
  },
};

const DE: TplStrings = {
  booking_confirmation: {
    subject: (s, d) => `${s} · Ihr Termin am ${d}`,
    subject_no_date: (s) => `${s} · Ihr Termin ist bestätigt`,
    title: "Ihr Termin steht",
    intro_named: (f, s) => `${f}, Ihre Behandlung bei ${s} ist bestätigt. Wir freuen uns auf Sie.`,
    intro: (s) => `Ihre Behandlung bei ${s} ist bestätigt. Wir freuen uns auf Sie.`,
    cta_manage: "Termin verwalten",
    cta_route: "Route anzeigen",
    cta_calendar: "Zum Kalender hinzufügen",
    note_title: "Gut zu wissen",
    note_1: "Tragen Sie Ihren Termin direkt in Ihren Kalender ein.",
    note_2: "Sie können nicht kommen? Verwalten Sie Ihren Termin rechtzeitig.",
    terms_line: (l) => `Für diesen Termin gelten die <a href="${l}">Salonbedingungen</a>.`,
  },
  payment_receipt: {
    subject: (s, r) => `${s} · Zahlungsbeleg${r ? ` #${r}` : ""}`,
    title: "Ihr Zahlungsbeleg",
    intro: (s) => `Vielen Dank. Ihre Zahlung an ${s} wurde sicher verarbeitet.`,
    cta_receipt: "Beleg ansehen",
    cta_appointment: "Termin ansehen",
    total_label: "Gesamtbetrag",
    vat_line: (v, r) => `Inkl. MwSt. (${r}%): ${v}`,
    vat_no_rate: (v) => `Inkl. MwSt.: ${v}`,
  },
  appointment_reminder: {
    subject: (s, d) => `${s} · Erinnerung an ${d}`,
    title: "Bis bald zu Ihrem Termin",
    intro_named: (f, s) => `${f}, dies ist eine freundliche Erinnerung an Ihren Termin bei ${s}.`,
    intro: (s) => `Dies ist eine freundliche Erinnerung an Ihren Termin bei ${s}.`,
    cta_manage: "Termin verwalten",
    cta_route: "Route anzeigen",
    cta_calendar: "Zum Kalender hinzufügen",
    note_title: "Vor Ihrem Termin",
    note_default_tip: "Bitte kommen Sie ein paar Minuten früher.",
    note_reschedule: "Sie können nicht kommen? Verwalten Sie Ihren Termin rechtzeitig.",
  },
  booking_cancellation: {
    subject: (s) => `${s} · Stornierung bestätigt`,
    title: "Ihr Termin wurde storniert",
    intro: (s) => `Wir bestätigen, dass Ihr Termin bei ${s} storniert wurde. Sie können jederzeit einen neuen Termin buchen.`,
    status_cancelled: "Storniert",
    cta_new: "Neuen Termin buchen",
    cta_route: "Route anzeigen",
    note_title: "Hilfe benötigt?",
    note_check: "Bitte kontaktieren Sie uns, falls das nicht korrekt ist.",
    note_contact: (e) => `Sie erreichen uns unter ${e}.`,
    note_help: "Unser Team hilft Ihnen gerne, einen neuen Termin zu planen.",
  },
  membership_notification: {
    subject: (s) => `${s} · Willkommen bei Ihrem Abo`,
    title: "Willkommen bei Ihrem Abo",
    intro_named: (f, s) => `${f}, willkommen bei Ihrem Abo von ${s}. Ihre Vorteile stehen bereit.`,
    intro: (s) => `Willkommen bei Ihrem Abo von ${s}. Ihre Vorteile stehen bereit.`,
    cta_manage: "Abo verwalten",
    cta_book: "Neuen Termin buchen",
    status_active: "Aktiv",
    benefits_title: "Ihre Vorteile",
  },
  review_request: {
    subject: (s) => `${s} · wie war Ihr Besuch?`,
    title: "Vielen Dank für Ihren Besuch",
    intro_named: (f, s) => `${f}, vielen Dank für Ihren Besuch bei ${s}. Wir hoffen, Sie sind mit Ihrer Behandlung zufrieden.`,
    intro: (s) => `Vielen Dank für Ihren Besuch bei ${s}. Wir hoffen, Sie sind mit Ihrer Behandlung zufrieden.`,
    body_text: "Mit Ihrer Bewertung helfen Sie uns, das Salonerlebnis zu verbessern und neue Kunden mit Vertrauen wählen zu lassen.",
    cta_review: "Bewertung schreiben",
    cta_rebook: "Neuen Termin buchen",
  },
  shared: {
    row_customer: "Kunde",
    row_date: "Datum",
    row_time: "Uhrzeit",
    row_service: "Behandlung",
    row_staff: "Mitarbeiter",
    row_location: "Ort",
    row_reference: "Referenz",
    row_total: "Gesamt",
    row_status: "Status",
    row_method: "Zahlungsmethode",
    row_description: "Beschreibung",
    row_vat: "MwSt.",
    row_vat_active: "Aktiv",
    row_membership: "Abo",
    row_credits: "Guthaben",
    row_next_payment: "Nächste Zahlung",
    row_monthly: "Monatsbetrag",
    row_support: "Support",
    footer: (s) => `Gesendet von ${s} über GlowSuite. Dies ist eine Servicenachricht zu Ihrem Termin, Ihrer Zahlung oder Ihrem Abo.`,
    fallback_link_prefix: "Funktioniert die Schaltfläche nicht? Kopieren Sie diesen Link:",
  },
};

const FR: TplStrings = {
  booking_confirmation: {
    subject: (s, d) => `${s} · votre rendez-vous le ${d}`,
    subject_no_date: (s) => `${s} · votre rendez-vous est confirmé`,
    title: "Votre rendez-vous est prêt",
    intro_named: (f, s) => `${f}, votre soin chez ${s} est confirmé. Nous avons hâte de vous accueillir.`,
    intro: (s) => `Votre soin chez ${s} est confirmé. Nous avons hâte de vous accueillir.`,
    cta_manage: "Gérer le rendez-vous",
    cta_route: "Voir l'itinéraire",
    cta_calendar: "Ajouter au calendrier",
    note_title: "Bon à savoir",
    note_1: "Ajoutez votre rendez-vous à votre agenda.",
    note_2: "Empêché·e ? Gérez votre rendez-vous à temps.",
    terms_line: (l) => `Ce rendez-vous est soumis aux <a href="${l}">conditions du salon</a>.`,
  },
  payment_receipt: {
    subject: (s, r) => `${s} · reçu de paiement${r ? ` #${r}` : ""}`,
    title: "Votre reçu de paiement",
    intro: (s) => `Merci. Votre paiement à ${s} a été traité en toute sécurité.`,
    cta_receipt: "Voir le reçu",
    cta_appointment: "Voir le rendez-vous",
    total_label: "Total payé",
    vat_line: (v, r) => `TVA incluse (${r}%) : ${v}`,
    vat_no_rate: (v) => `TVA incluse : ${v}`,
  },
  appointment_reminder: {
    subject: (s, d) => `${s} · rappel pour ${d}`,
    title: "À bientôt pour votre rendez-vous",
    intro_named: (f, s) => `${f}, ceci est un rappel amical de votre rendez-vous chez ${s}.`,
    intro: (s) => `Ceci est un rappel amical de votre rendez-vous chez ${s}.`,
    cta_manage: "Gérer le rendez-vous",
    cta_route: "Voir l'itinéraire",
    cta_calendar: "Ajouter au calendrier",
    note_title: "Avant votre rendez-vous",
    note_default_tip: "Merci d'arriver quelques minutes en avance.",
    note_reschedule: "Empêché·e ? Gérez votre rendez-vous à temps.",
  },
  booking_cancellation: {
    subject: (s) => `${s} · annulation confirmée`,
    title: "Votre rendez-vous a été annulé",
    intro: (s) => `Nous confirmons que votre rendez-vous chez ${s} a été annulé. Vous pouvez réserver un nouveau créneau à tout moment.`,
    status_cancelled: "Annulé",
    cta_new: "Prendre un nouveau rendez-vous",
    cta_route: "Voir l'itinéraire",
    note_title: "Besoin d'aide ?",
    note_check: "Contactez-nous si ce n'est pas correct.",
    note_contact: (e) => `Vous pouvez nous joindre à ${e}.`,
    note_help: "Notre équipe se fera un plaisir de vous aider à choisir un nouveau créneau.",
  },
  membership_notification: {
    subject: (s) => `${s} · bienvenue dans votre abonnement`,
    title: "Bienvenue dans votre abonnement",
    intro_named: (f, s) => `${f}, bienvenue dans votre abonnement chez ${s}. Vos avantages vous attendent.`,
    intro: (s) => `Bienvenue dans votre abonnement chez ${s}. Vos avantages vous attendent.`,
    cta_manage: "Gérer l'abonnement",
    cta_book: "Prendre un rendez-vous",
    status_active: "Actif",
    benefits_title: "Vos avantages",
  },
  review_request: {
    subject: (s) => `${s} · comment s'est passée votre visite ?`,
    title: "Merci pour votre visite",
    intro_named: (f, s) => `${f}, merci pour votre visite chez ${s}. Nous espérons que vous êtes satisfait·e de votre soin.`,
    intro: (s) => `Merci pour votre visite chez ${s}. Nous espérons que vous êtes satisfait·e de votre soin.`,
    body_text: "Votre avis nous aide à améliorer l'expérience en salon et aide les nouveaux clients à choisir en confiance.",
    cta_review: "Laisser un avis",
    cta_rebook: "Prendre un rendez-vous",
  },
  shared: {
    row_customer: "Client",
    row_date: "Date",
    row_time: "Heure",
    row_service: "Soin",
    row_staff: "Praticien",
    row_location: "Lieu",
    row_reference: "Référence",
    row_total: "Total",
    row_status: "Statut",
    row_method: "Moyen de paiement",
    row_description: "Description",
    row_vat: "TVA",
    row_vat_active: "Actif",
    row_membership: "Abonnement",
    row_credits: "Crédits",
    row_next_payment: "Prochain prélèvement",
    row_monthly: "Montant mensuel",
    row_support: "Support",
    footer: (s) => `Envoyé par ${s} via GlowSuite. Il s'agit d'un message de service concernant votre rendez-vous, paiement ou abonnement.`,
    fallback_link_prefix: "Le bouton ne fonctionne pas ? Copiez ce lien :",
  },
};

const ES: TplStrings = {
  booking_confirmation: {
    subject: (s, d) => `${s} · tu cita el ${d}`,
    subject_no_date: (s) => `${s} · tu cita está confirmada`,
    title: "Tu cita está lista",
    intro_named: (f, s) => `${f}, tu tratamiento en ${s} está confirmado. Tenemos muchas ganas de recibirte.`,
    intro: (s) => `Tu tratamiento en ${s} está confirmado. Tenemos muchas ganas de recibirte.`,
    cta_manage: "Gestionar cita",
    cta_route: "Ver ruta",
    cta_calendar: "Añadir al calendario",
    note_title: "Información útil",
    note_1: "Añade tu cita al calendario.",
    note_2: "¿No puedes venir? Gestiona tu cita a tiempo.",
    terms_line: (l) => `Esta cita está sujeta a las <a href="${l}">condiciones del salón</a>.`,
  },
  payment_receipt: {
    subject: (s, r) => `${s} · recibo de pago${r ? ` #${r}` : ""}`,
    title: "Tu recibo de pago",
    intro: (s) => `Gracias. Tu pago a ${s} se ha procesado de forma segura.`,
    cta_receipt: "Ver recibo",
    cta_appointment: "Ver cita",
    total_label: "Total pagado",
    vat_line: (v, r) => `IVA incluido (${r}%): ${v}`,
    vat_no_rate: (v) => `IVA incluido: ${v}`,
  },
  appointment_reminder: {
    subject: (s, d) => `${s} · recordatorio para ${d}`,
    title: "Nos vemos pronto",
    intro_named: (f, s) => `${f}, este es un recordatorio amistoso de tu cita en ${s}.`,
    intro: (s) => `Este es un recordatorio amistoso de tu cita en ${s}.`,
    cta_manage: "Gestionar cita",
    cta_route: "Ver ruta",
    cta_calendar: "Añadir al calendario",
    note_title: "Antes de tu cita",
    note_default_tip: "Llega unos minutos antes, por favor.",
    note_reschedule: "¿No puedes venir? Gestiona tu cita a tiempo.",
  },
  booking_cancellation: {
    subject: (s) => `${s} · cancelación confirmada`,
    title: "Tu cita ha sido cancelada",
    intro: (s) => `Confirmamos que tu cita en ${s} ha sido cancelada. Puedes reservar otro momento cuando quieras.`,
    status_cancelled: "Cancelada",
    cta_new: "Reservar nueva cita",
    cta_route: "Ver ruta",
    note_title: "¿Necesitas ayuda?",
    note_check: "Contáctanos si esto no es correcto.",
    note_contact: (e) => `Puedes escribirnos a ${e}.`,
    note_help: "Nuestro equipo te ayudará a reservar un nuevo momento.",
  },
  membership_notification: {
    subject: (s) => `${s} · bienvenido/a a tu suscripción`,
    title: "Bienvenido/a a tu suscripción",
    intro_named: (f, s) => `${f}, bienvenido/a a tu suscripción en ${s}. Tus ventajas te están esperando.`,
    intro: (s) => `Bienvenido/a a tu suscripción en ${s}. Tus ventajas te están esperando.`,
    cta_manage: "Gestionar suscripción",
    cta_book: "Reservar nueva cita",
    status_active: "Activa",
    benefits_title: "Tus ventajas",
  },
  review_request: {
    subject: (s) => `${s} · ¿qué tal tu visita?`,
    title: "Gracias por tu visita",
    intro_named: (f, s) => `${f}, gracias por visitar ${s}. Esperamos que estés satisfecho/a con tu tratamiento.`,
    intro: (s) => `Gracias por visitar ${s}. Esperamos que estés satisfecho/a con tu tratamiento.`,
    body_text: "Tu reseña nos ayuda a mejorar la experiencia y ayuda a nuevos clientes a elegir con confianza.",
    cta_review: "Escribir reseña",
    cta_rebook: "Reservar nueva cita",
  },
  shared: {
    row_customer: "Cliente",
    row_date: "Fecha",
    row_time: "Hora",
    row_service: "Tratamiento",
    row_staff: "Profesional",
    row_location: "Ubicación",
    row_reference: "Referencia",
    row_total: "Total",
    row_status: "Estado",
    row_method: "Método de pago",
    row_description: "Descripción",
    row_vat: "IVA",
    row_vat_active: "Activo",
    row_membership: "Suscripción",
    row_credits: "Créditos",
    row_next_payment: "Próximo cobro",
    row_monthly: "Importe mensual",
    row_support: "Soporte",
    footer: (s) => `Enviado por ${s} a través de GlowSuite. Es un mensaje de servicio sobre tu cita, pago o suscripción.`,
    fallback_link_prefix: "¿No funciona el botón? Copia este enlace:",
  },
};

const ALL: Record<EmailLang, TplStrings> = { nl: NL, en: EN, de: DE, fr: FR, es: ES };

export function emailStrings(lang: EmailLang): TplStrings {
  return ALL[lang] || NL;
}
