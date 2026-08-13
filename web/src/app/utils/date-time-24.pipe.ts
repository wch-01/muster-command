import { Pipe, type PipeTransform } from "@angular/core";
import { formatDateTime24 } from "./event-time";

@Pipe({ name: "dateTime24", standalone: true })
export class DateTime24Pipe implements PipeTransform {
  transform(value: string | Date | null | undefined) {
    return formatDateTime24(value);
  }
}
