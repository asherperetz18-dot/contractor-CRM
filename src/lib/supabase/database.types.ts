// Placeholder until the schema is applied in Supabase and real types are
// generated with:
//   npx supabase gen types typescript --project-id <ref> > src/lib/supabase/database.types.ts
// Loose (not `never`) so `.from(...)` calls type-check in the meantime.
type LooseTable = {
  Row: Record<string, unknown>;
  Insert: Record<string, unknown>;
  Update: Record<string, unknown>;
};

export type Database = {
  public: {
    Tables: Record<string, LooseTable>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
