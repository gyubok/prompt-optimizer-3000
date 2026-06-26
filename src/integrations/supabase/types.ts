export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      dataset_files: {
        Row: {
          created_at: string
          dataset_id: string
          file_name: string
          id: string
          page_number: number
          storage_path: string
        }
        Insert: {
          created_at?: string
          dataset_id: string
          file_name: string
          id?: string
          page_number?: number
          storage_path: string
        }
        Update: {
          created_at?: string
          dataset_id?: string
          file_name?: string
          id?: string
          page_number?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "dataset_files_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "datasets"
            referencedColumns: ["id"]
          },
        ]
      }
      datasets: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      ground_truth: {
        Row: {
          asset_type: string
          count: number
          dataset_id: string
          file_name: string
          id: string
          locations: Json
          page_number: number
        }
        Insert: {
          asset_type: string
          count: number
          dataset_id: string
          file_name: string
          id?: string
          locations?: Json
          page_number?: number
        }
        Update: {
          asset_type?: string
          count?: number
          dataset_id?: string
          file_name?: string
          id?: string
          locations?: Json
          page_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "ground_truth_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "datasets"
            referencedColumns: ["id"]
          },
        ]
      }
      iteration_results: {
        Row: {
          created_at: string
          delta: number | null
          file_name: string
          id: string
          iteration_id: string
          page_number: number
          pass1_confidence: number | null
          pass1_hint_point: string | null
          pass1_keywords: string[] | null
          pass1_relevant: boolean | null
          pass2_detections: Json | null
          pass2_raw_output: string | null
          pass2_valid_json: boolean | null
          predicted_count: number
          spatial_matches: Json | null
          spatial_score: number | null
          truth_count: number
        }
        Insert: {
          created_at?: string
          delta?: number | null
          file_name: string
          id?: string
          iteration_id: string
          page_number?: number
          pass1_confidence?: number | null
          pass1_hint_point?: string | null
          pass1_keywords?: string[] | null
          pass1_relevant?: boolean | null
          pass2_detections?: Json | null
          pass2_raw_output?: string | null
          pass2_valid_json?: boolean | null
          predicted_count?: number
          spatial_matches?: Json | null
          spatial_score?: number | null
          truth_count: number
        }
        Update: {
          created_at?: string
          delta?: number | null
          file_name?: string
          id?: string
          iteration_id?: string
          page_number?: number
          pass1_confidence?: number | null
          pass1_hint_point?: string | null
          pass1_keywords?: string[] | null
          pass1_relevant?: boolean | null
          pass2_detections?: Json | null
          pass2_raw_output?: string | null
          pass2_valid_json?: boolean | null
          predicted_count?: number
          spatial_matches?: Json | null
          spatial_score?: number | null
          truth_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "iteration_results_iteration_id_fkey"
            columns: ["iteration_id"]
            isOneToOne: false
            referencedRelation: "iterations"
            referencedColumns: ["id"]
          },
        ]
      }
      iterations: {
        Row: {
          after_gate_score: number | null
          batch_cursor: number
          created_at: string
          cumulative_cost: number | null
          e2e_score: number | null
          estimated_cost: number | null
          gemini_file_cache: Json
          id: string
          iteration_number: number
          last_progress_at: string | null
          progress_log: Json
          prompt_diff: string | null
          prompt_text: string
          reasoning_json: Json | null
          run_id: string
          status: Database["public"]["Enums"]["iteration_status"]
          token_usage_json: Json | null
        }
        Insert: {
          after_gate_score?: number | null
          batch_cursor?: number
          created_at?: string
          cumulative_cost?: number | null
          e2e_score?: number | null
          estimated_cost?: number | null
          gemini_file_cache?: Json
          id?: string
          iteration_number: number
          last_progress_at?: string | null
          progress_log?: Json
          prompt_diff?: string | null
          prompt_text: string
          reasoning_json?: Json | null
          run_id: string
          status?: Database["public"]["Enums"]["iteration_status"]
          token_usage_json?: Json | null
        }
        Update: {
          after_gate_score?: number | null
          batch_cursor?: number
          created_at?: string
          cumulative_cost?: number | null
          e2e_score?: number | null
          estimated_cost?: number | null
          gemini_file_cache?: Json
          id?: string
          iteration_number?: number
          last_progress_at?: string | null
          progress_log?: Json
          prompt_diff?: string | null
          prompt_text?: string
          reasoning_json?: Json | null
          run_id?: string
          status?: Database["public"]["Enums"]["iteration_status"]
          token_usage_json?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "iterations_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      pdf_uploads: {
        Row: {
          created_at: string
          expires_at: string
          gemini_file_name: string
          gemini_file_uri: string
          storage_path: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          gemini_file_name: string
          gemini_file_uri: string
          storage_path: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          gemini_file_name?: string
          gemini_file_uri?: string
          storage_path?: string
        }
        Relationships: []
      }
      runs: {
        Row: {
          asset_type: string
          created_at: string
          current_iteration: number
          dataset_id: string
          floor_plan_prompt: string | null
          id: string
          initial_prompt: string
          max_iterations: number
          mode: Database["public"]["Enums"]["run_mode"]
          pass1_threshold: number
          stall_threshold: number
          status: Database["public"]["Enums"]["run_status"]
          updated_at: string
        }
        Insert: {
          asset_type: string
          created_at?: string
          current_iteration?: number
          dataset_id: string
          floor_plan_prompt?: string | null
          id?: string
          initial_prompt: string
          max_iterations?: number
          mode?: Database["public"]["Enums"]["run_mode"]
          pass1_threshold?: number
          stall_threshold?: number
          status?: Database["public"]["Enums"]["run_status"]
          updated_at?: string
        }
        Update: {
          asset_type?: string
          created_at?: string
          current_iteration?: number
          dataset_id?: string
          floor_plan_prompt?: string | null
          id?: string
          initial_prompt?: string
          max_iterations?: number
          mode?: Database["public"]["Enums"]["run_mode"]
          pass1_threshold?: number
          stall_threshold?: number
          status?: Database["public"]["Enums"]["run_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "runs_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "datasets"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      iteration_status:
        | "pending"
        | "processing"
        | "scoring"
        | "paused_manual"
        | "completed"
        | "failed"
      run_mode: "auto" | "manual"
      run_status:
        | "queued"
        | "running"
        | "paused_manual"
        | "stopping"
        | "stopped"
        | "completed"
        | "failed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      iteration_status: [
        "pending",
        "processing",
        "scoring",
        "paused_manual",
        "completed",
        "failed",
      ],
      run_mode: ["auto", "manual"],
      run_status: [
        "queued",
        "running",
        "paused_manual",
        "stopping",
        "stopped",
        "completed",
        "failed",
      ],
    },
  },
} as const
