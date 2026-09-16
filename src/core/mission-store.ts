import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Event, Mission } from "./types.js";

export interface MissionStore {
  saveMission(mission: Mission): Promise<void>;
  loadMission(id: string): Promise<Mission | undefined>;
  listMissions(): Promise<Mission[]>;
  appendEvent(event: Event): Promise<void>;
  loadEvents(id: string): Promise<Event[]>;
}

/** Durable local store for development. Swap this interface for PostgreSQL in production. */
export class JsonMissionStore implements MissionStore {
  private readonly root: string;
  constructor(root = process.env.ASHAI_DATA_DIR ?? ".ashai") { this.root = resolve(root); }
  private missionsFile = () => resolve(this.root, "missions.json");
  private eventsFile = (id: string) => resolve(this.root, "events", `${id}.json`);

  async saveMission(mission: Mission): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const missions = await this.listMissions();
    const index = missions.findIndex(item => item.id === mission.id);
    if (index >= 0) missions[index] = structuredClone(mission); else missions.push(structuredClone(mission));
    await writeFile(this.missionsFile(), JSON.stringify(missions, null, 2));
  }
  async loadMission(id: string): Promise<Mission | undefined> { return (await this.listMissions()).find(item => item.id === id); }
  async listMissions(): Promise<Mission[]> {
    try { return JSON.parse(await readFile(this.missionsFile(), "utf8")) as Mission[]; }
    catch { return []; }
  }
  async appendEvent(event: Event): Promise<void> {
    const path = this.eventsFile(event.missionId);
    await mkdir(dirname(path), { recursive: true });
    const events = await this.loadEvents(event.missionId);
    events.push(structuredClone(event));
    await writeFile(path, JSON.stringify(events, null, 2));
  }
  async loadEvents(id: string): Promise<Event[]> {
    try { return JSON.parse(await readFile(this.eventsFile(id), "utf8")) as Event[]; }
    catch { return []; }
  }
}
