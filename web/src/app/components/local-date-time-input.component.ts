import { CommonModule } from "@angular/common";
import { Component, forwardRef, Input } from "@angular/core";
import { FormsModule, NG_VALUE_ACCESSOR, type ControlValueAccessor } from "@angular/forms";

@Component({
  selector: "mc-local-date-time-input",
  standalone: true,
  imports: [CommonModule, FormsModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => LocalDateTimeInputComponent),
      multi: true,
    },
  ],
  template: `
    <div class="date-time-input">
      <label>
        <span class="control-label">Date</span>
        <input type="date" [(ngModel)]="date" [disabled]="disabled" (ngModelChange)="updateValue()" (blur)="markTouched()" />
      </label>
      <label>
        <span class="control-label">Time (24-hour)</span>
        <span class="time-selects">
          <select aria-label="Hour in 24-hour time" [(ngModel)]="hour" [disabled]="disabled" (ngModelChange)="updateValue()" (blur)="markTouched()">
            <option value="">Hour</option>
            <option *ngFor="let option of hours" [value]="option">{{ option }}</option>
          </select>
          <select aria-label="Minute" [(ngModel)]="minute" [disabled]="disabled" (ngModelChange)="updateValue()" (blur)="markTouched()">
            <option value="">Minute</option>
            <option *ngFor="let option of minutes" [value]="option">{{ option }}</option>
          </select>
        </span>
      </label>
    </div>
  `,
  styles: [`
    .date-time-input { display: grid; gap: 10px; grid-template-columns: minmax(0, 1fr) minmax(190px, 1fr); }
    label { display: grid; gap: 6px; min-width: 0; }
    .control-label { color: #334155; font-size: 12px; font-weight: 800; letter-spacing: .035em; text-transform: uppercase; }
    input, select {
      appearance: auto;
      background: #fff;
      border: 1px solid #aeb9c8;
      border-radius: 7px;
      color: #172033;
      font: inherit;
      min-height: 42px;
      min-width: 0;
      outline: none;
      padding: 9px 11px;
      width: 100%;
    }
    input:focus, select:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37, 99, 235, .12); }
    input:disabled, select:disabled { cursor: not-allowed; opacity: .65; }
    .time-selects { display: grid; gap: 8px; grid-template-columns: 1fr 1fr; }
    @media (max-width: 520px) { .date-time-input { grid-template-columns: 1fr; } }
  `],
})
export class LocalDateTimeInputComponent implements ControlValueAccessor {
  @Input() disabled = false;
  date = "";
  hour = "";
  minute = "";
  readonly hours = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
  readonly minutes = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, "0"));
  private onChange: (value: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  writeValue(value: string | null | undefined) {
    const [date = "", time = ""] = (value ?? "").split("T");
    this.date = date;
    [this.hour = "", this.minute = ""] = time.slice(0, 5).split(":");
  }

  registerOnChange(fn: (value: string) => void) {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void) {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean) {
    this.disabled = disabled;
  }

  updateValue() {
    this.onChange(this.date && this.hour && this.minute ? `${this.date}T${this.hour}:${this.minute}` : "");
  }

  markTouched() {
    this.onTouched();
  }
}
