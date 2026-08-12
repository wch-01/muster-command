import { CommonModule } from "@angular/common";
import { ChangeDetectorRef, Component, OnInit } from "@angular/core";
import { IonContent } from "@ionic/angular/standalone";
import { AppMenuComponent } from "../components/app-menu.component";
import { SiteFooterComponent } from "../components/site-footer.component";
import { ApiService } from "../services/api.service";

@Component({ selector:"app-bot-commands-page", standalone:true, imports:[CommonModule,IonContent,AppMenuComponent,SiteFooterComponent], templateUrl:"./bot-commands.page.html", styleUrls:["./bot-commands.page.scss"] })
export class BotCommandsPage implements OnInit {
  html=""; error="";
  constructor(private readonly api:ApiService,private readonly cd:ChangeDetectorRef){}
  ngOnInit(){this.api.getBotCommands().subscribe({next:r=>{this.html=r.html;this.cd.detectChanges();},error:e=>{this.error=e.error?.error??"Command reference could not be loaded.";this.cd.detectChanges();}})}
}
