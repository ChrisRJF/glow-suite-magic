import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { weekDays, timeSlots, weekAppointments, todaysAppointments } from "@/lib/data";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

type View = 'day' | 'week';

export default function CalendarPage() {
  const [view, setView] = useState<View>('day');
  const [selectedDay, setSelectedDay] = useState('Mon');

  const currentAppointments = view === 'day' ? todaysAppointments : null;

  return (
    <AppLayout
      title="Calendar"
      subtitle="Manage your appointments and find open slots."
      actions={
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-border overflow-hidden">
            <button
              onClick={() => setView('day')}
              className={cn(
                "px-4 py-2 text-sm font-medium transition-colors",
                view === 'day' ? 'bg-primary text-primary-foreground' : 'bg-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              Day
            </button>
            <button
              onClick={() => setView('week')}
              className={cn(
                "px-4 py-2 text-sm font-medium transition-colors",
                view === 'week' ? 'bg-primary text-primary-foreground' : 'bg-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              Week
            </button>
          </div>
          <Button variant="gradient" size="sm">
            <Plus className="w-4 h-4" /> New Booking
          </Button>
        </div>
      }
    >
      <div className="glass-card p-5 opacity-0 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
        {/* Date navigation */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <button className="p-2 rounded-lg hover:bg-secondary transition-colors">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <h3 className="text-base font-semibold">
              {view === 'day' ? 'Monday, March 21' : 'March 17 – 22, 2026'}
            </h3>
            <button className="p-2 rounded-lg hover:bg-secondary transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <span className="text-sm text-muted-foreground">
            {view === 'day' ? `${todaysAppointments.length} appointments` : '18 appointments this week'}
          </span>
        </div>

        {view === 'day' ? (
          <DayView appointments={todaysAppointments} />
        ) : (
          <WeekView selectedDay={selectedDay} onSelectDay={setSelectedDay} />
        )}
      </div>
    </AppLayout>
  );
}

function DayView({ appointments }: { appointments: typeof todaysAppointments }) {
  return (
    <div className="relative">
      {timeSlots.map((slot) => {
        const apt = appointments.find((a) => a.time === slot);
        const isEmpty = !apt;
        return (
          <div key={slot} className="flex gap-4 group min-h-[48px]">
            <span className="w-14 text-xs text-muted-foreground py-3 tabular-nums flex-shrink-0">{slot}</span>
            <div className="flex-1 border-t border-border/50 relative">
              {apt ? (
                <div
                  className="absolute inset-x-0 top-1 rounded-xl p-3 transition-all duration-200 hover:scale-[1.01] cursor-pointer"
                  style={{
                    backgroundColor: `${apt.color}15`,
                    borderLeft: `3px solid ${apt.color}`,
                    minHeight: `${(apt.duration / 30) * 48 - 8}px`,
                  }}
                >
                  <p className="text-sm font-medium">{apt.customerName}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-xs text-muted-foreground">{apt.service}</p>
                    <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                      <Clock className="w-3 h-3" />{apt.duration}m
                    </span>
                  </div>
                </div>
              ) : (
                <div className="absolute inset-x-0 top-1 h-[40px] rounded-xl border border-dashed border-border/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer hover:bg-secondary/30">
                  <Plus className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WeekView({ selectedDay, onSelectDay }: { selectedDay: string; onSelectDay: (d: string) => void }) {
  return (
    <div className="overflow-x-auto">
      <div className="grid grid-cols-6 gap-3 min-w-[700px]">
        {weekDays.map((day) => {
          const apts = weekAppointments[day] || [];
          return (
            <div key={day} className="flex flex-col">
              <button
                onClick={() => onSelectDay(day)}
                className={cn(
                  "text-sm font-semibold mb-3 pb-2 border-b-2 transition-colors text-left",
                  selectedDay === day ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                {day}
                <span className="ml-2 text-xs text-muted-foreground">{apts.length}</span>
              </button>
              <div className="space-y-2 flex-1">
                {apts.map((apt) => (
                  <div
                    key={apt.id}
                    className="p-2.5 rounded-xl cursor-pointer transition-all duration-200 hover:scale-[1.02]"
                    style={{
                      backgroundColor: `${apt.color}12`,
                      borderLeft: `2px solid ${apt.color}`,
                    }}
                  >
                    <p className="text-xs font-medium truncate">{apt.customerName}</p>
                    <p className="text-[11px] text-muted-foreground">{apt.time} · {apt.service}</p>
                  </div>
                ))}
                {apts.length < 4 && (
                  <button className="w-full p-2 rounded-xl border border-dashed border-border/50 text-xs text-muted-foreground hover:bg-secondary/30 hover:text-foreground transition-colors">
                    <Plus className="w-3 h-3 inline mr-1" />Open
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
