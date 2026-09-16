export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      ai_usage: {
        Row: {
          college_id: string | null
          cost_usd: number
          course_id: string | null
          created_at: string
          id: string
          input_rate: number | null
          input_tokens: number
          model: string
          operation: string
          output_rate: number | null
          output_tokens: number
          succeeded: boolean
          test_set_id: string | null
          total_tokens: number
          user_id: string | null
        }
        Insert: {
          college_id?: string | null
          cost_usd?: number
          course_id?: string | null
          created_at?: string
          id?: string
          input_rate?: number | null
          input_tokens?: number
          model: string
          operation: string
          output_rate?: number | null
          output_tokens?: number
          succeeded?: boolean
          test_set_id?: string | null
          total_tokens?: number
          user_id?: string | null
        }
        Update: {
          college_id?: string | null
          cost_usd?: number
          course_id?: string | null
          created_at?: string
          id?: string
          input_rate?: number | null
          input_tokens?: number
          model?: string
          operation?: string
          output_rate?: number | null
          output_tokens?: number
          succeeded?: boolean
          test_set_id?: string | null
          total_tokens?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "college_stats"
            referencedColumns: ["college_id"]
          },
          {
            foreignKeyName: "ai_usage_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_test_set_id_fkey"
            columns: ["test_set_id"]
            isOneToOne: false
            referencedRelation: "test_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      attempt_answers: {
        Row: {
          answer: string | null
          answered_at: string
          attempt_id: string
          flagged: boolean
          id: string
          is_correct: boolean | null
          question_id: string
        }
        Insert: {
          answer?: string | null
          answered_at?: string
          attempt_id: string
          flagged?: boolean
          id?: string
          is_correct?: boolean | null
          question_id: string
        }
        Update: {
          answer?: string | null
          answered_at?: string
          attempt_id?: string
          flagged?: boolean
          id?: string
          is_correct?: boolean | null
          question_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attempt_answers_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempt_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      attempts: {
        Row: {
          id: string
          score: number | null
          started_at: string
          submitted_at: string | null
          test_set_id: string
          total_questions: number
          user_id: string
        }
        Insert: {
          id?: string
          score?: number | null
          started_at?: string
          submitted_at?: string | null
          test_set_id: string
          total_questions?: number
          user_id: string
        }
        Update: {
          id?: string
          score?: number | null
          started_at?: string
          submitted_at?: string | null
          test_set_id?: string
          total_questions?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attempts_test_set_id_fkey"
            columns: ["test_set_id"]
            isOneToOne: false
            referencedRelation: "test_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      bulk_job_events: {
        Row: {
          created_at: string
          event: Json
          job_id: string
          seq: number
        }
        Insert: {
          created_at?: string
          event: Json
          job_id: string
          seq: number
        }
        Update: {
          created_at?: string
          event?: Json
          job_id?: string
          seq?: number
        }
        Relationships: [
          {
            foreignKeyName: "bulk_job_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "bulk_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      bulk_job_items: {
        Row: {
          college_id: string
          cost_usd: number
          job_id: string
          position: number
          status: string
          summary: string | null
          updated_at: string
        }
        Insert: {
          college_id: string
          cost_usd?: number
          job_id: string
          position: number
          status?: string
          summary?: string | null
          updated_at?: string
        }
        Update: {
          college_id?: string
          cost_usd?: number
          job_id?: string
          position?: number
          status?: string
          summary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bulk_job_items_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "college_stats"
            referencedColumns: ["college_id"]
          },
          {
            foreignKeyName: "bulk_job_items_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bulk_job_items_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "bulk_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      bulk_jobs: {
        Row: {
          cancel_requested: boolean
          created_at: string
          created_by: string | null
          current_college_id: string | null
          error: string | null
          failed: number
          finished_at: string | null
          heartbeat_at: string
          id: string
          params: Json
          processed: number
          status: string
          succeeded: number
          total: number
          total_cost_usd: number
        }
        Insert: {
          cancel_requested?: boolean
          created_at?: string
          created_by?: string | null
          current_college_id?: string | null
          error?: string | null
          failed?: number
          finished_at?: string | null
          heartbeat_at?: string
          id?: string
          params: Json
          processed?: number
          status?: string
          succeeded?: number
          total?: number
          total_cost_usd?: number
        }
        Update: {
          cancel_requested?: boolean
          created_at?: string
          created_by?: string | null
          current_college_id?: string | null
          error?: string | null
          failed?: number
          finished_at?: string | null
          heartbeat_at?: string
          id?: string
          params?: Json
          processed?: number
          status?: string
          succeeded?: number
          total?: number
          total_cost_usd?: number
        }
        Relationships: [
          {
            foreignKeyName: "bulk_jobs_current_college_id_fkey"
            columns: ["current_college_id"]
            isOneToOne: false
            referencedRelation: "college_stats"
            referencedColumns: ["college_id"]
          },
          {
            foreignKeyName: "bulk_jobs_current_college_id_fkey"
            columns: ["current_college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
        ]
      }
      colleges: {
        Row: {
          catalog_discovered_at: string | null
          catalog_error: string | null
          catalog_platform: string | null
          catalog_source: string | null
          catalog_url: string | null
          city: string | null
          created_at: string
          id: string
          logo_url: string | null
          name: string
          rank: number | null
          short_name: string | null
          state: string | null
          website_domain: string
        }
        Insert: {
          catalog_discovered_at?: string | null
          catalog_error?: string | null
          catalog_platform?: string | null
          catalog_source?: string | null
          catalog_url?: string | null
          city?: string | null
          created_at?: string
          id?: string
          logo_url?: string | null
          name: string
          rank?: number | null
          short_name?: string | null
          state?: string | null
          website_domain: string
        }
        Update: {
          catalog_discovered_at?: string | null
          catalog_error?: string | null
          catalog_platform?: string | null
          catalog_source?: string | null
          catalog_url?: string | null
          city?: string | null
          created_at?: string
          id?: string
          logo_url?: string | null
          name?: string
          rank?: number | null
          short_name?: string | null
          state?: string | null
          website_domain?: string
        }
        Relationships: []
      }
      course_sections: {
        Row: {
          course_id: string
          created_at: string
          id: string
          position: number
          source: string
          title: string
          topics: string[]
        }
        Insert: {
          course_id: string
          created_at?: string
          id?: string
          position?: number
          source?: string
          title: string
          topics?: string[]
        }
        Update: {
          course_id?: string
          created_at?: string
          id?: string
          position?: number
          source?: string
          title?: string
          topics?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "course_sections_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          ai_summary: string | null
          course_number: string
          created_at: string
          credits: string | null
          department_id: string
          description: string | null
          detail_scraped_at: string | null
          id: string
          instructors: string[] | null
          prerequisites: string | null
          raw_scraped_content: string | null
          scraped_at: string
          source_url: string | null
          syllabus_url: string | null
          terms_offered: string | null
          title: string
        }
        Insert: {
          ai_summary?: string | null
          course_number: string
          created_at?: string
          credits?: string | null
          department_id: string
          description?: string | null
          detail_scraped_at?: string | null
          id?: string
          instructors?: string[] | null
          prerequisites?: string | null
          raw_scraped_content?: string | null
          scraped_at?: string
          source_url?: string | null
          syllabus_url?: string | null
          terms_offered?: string | null
          title: string
        }
        Update: {
          ai_summary?: string | null
          course_number?: string
          created_at?: string
          credits?: string | null
          department_id?: string
          description?: string | null
          detail_scraped_at?: string | null
          id?: string
          instructors?: string[] | null
          prerequisites?: string | null
          raw_scraped_content?: string | null
          scraped_at?: string
          source_url?: string | null
          syllabus_url?: string | null
          terms_offered?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "courses_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          catalog_url: string | null
          code: string
          college_id: string
          created_at: string
          id: string
          name: string
          scraped_at: string
        }
        Insert: {
          catalog_url?: string | null
          code: string
          college_id: string
          created_at?: string
          id?: string
          name: string
          scraped_at?: string
        }
        Update: {
          catalog_url?: string | null
          code?: string
          college_id?: string
          created_at?: string
          id?: string
          name?: string
          scraped_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "departments_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "college_stats"
            referencedColumns: ["college_id"]
          },
          {
            foreignKeyName: "departments_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
        ]
      }
      favorites: {
        Row: {
          college_id: string | null
          course_id: string | null
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          college_id?: string | null
          course_id?: string | null
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          college_id?: string | null
          course_id?: string | null
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "college_stats"
            referencedColumns: ["college_id"]
          },
          {
            foreignKeyName: "favorites_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      operation_runs: {
        Row: {
          college_id: string | null
          cost_usd: number
          course_id: string | null
          finished_at: string
          id: string
          kind: string
          ok: boolean
          started_at: string
          summary: string | null
          test_set_id: string | null
          total_tokens: number
          user_id: string | null
        }
        Insert: {
          college_id?: string | null
          cost_usd?: number
          course_id?: string | null
          finished_at?: string
          id?: string
          kind: string
          ok?: boolean
          started_at: string
          summary?: string | null
          test_set_id?: string | null
          total_tokens?: number
          user_id?: string | null
        }
        Update: {
          college_id?: string | null
          cost_usd?: number
          course_id?: string | null
          finished_at?: string
          id?: string
          kind?: string
          ok?: boolean
          started_at?: string
          summary?: string | null
          test_set_id?: string | null
          total_tokens?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operation_runs_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "college_stats"
            referencedColumns: ["college_id"]
          },
          {
            foreignKeyName: "operation_runs_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operation_runs_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operation_runs_test_set_id_fkey"
            columns: ["test_set_id"]
            isOneToOne: false
            referencedRelation: "test_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      questions: {
        Row: {
          correct_answer: string
          created_at: string
          difficulty: string
          explanation: string | null
          id: string
          options: Json | null
          position: number
          question: string
          test_set_id: string
          topic: string | null
          type: string
        }
        Insert: {
          correct_answer: string
          created_at?: string
          difficulty: string
          explanation?: string | null
          id?: string
          options?: Json | null
          position: number
          question: string
          test_set_id: string
          topic?: string | null
          type: string
        }
        Update: {
          correct_answer?: string
          created_at?: string
          difficulty?: string
          explanation?: string | null
          id?: string
          options?: Json | null
          position?: number
          question?: string
          test_set_id?: string
          topic?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "questions_test_set_id_fkey"
            columns: ["test_set_id"]
            isOneToOne: false
            referencedRelation: "test_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      test_sets: {
        Row: {
          course_section_id: string
          created_at: string
          error: string | null
          id: string
          model_used: string | null
          question_count: number
          status: string
          target_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          course_section_id: string
          created_at?: string
          error?: string | null
          id?: string
          model_used?: string | null
          question_count?: number
          status?: string
          target_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          course_section_id?: string
          created_at?: string
          error?: string | null
          id?: string
          model_used?: string | null
          question_count?: number
          status?: string
          target_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_sets_course_section_id_fkey"
            columns: ["course_section_id"]
            isOneToOne: false
            referencedRelation: "course_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      textbooks: {
        Row: {
          authors: string | null
          course_id: string
          created_at: string
          edition: string | null
          id: string
          isbn: string | null
          required: boolean
          source: string
          title: string
        }
        Insert: {
          authors?: string | null
          course_id: string
          created_at?: string
          edition?: string | null
          id?: string
          isbn?: string | null
          required?: boolean
          source?: string
          title: string
        }
        Update: {
          authors?: string | null
          course_id?: string
          created_at?: string
          edition?: string | null
          id?: string
          isbn?: string | null
          required?: boolean
          source?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "textbooks_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      college_ai_cost: {
        Row: {
          call_count: number | null
          college_id: string | null
          cost_usd: number | null
          input_tokens: number | null
          output_tokens: number | null
          total_tokens: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "college_stats"
            referencedColumns: ["college_id"]
          },
          {
            foreignKeyName: "ai_usage_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
        ]
      }
      college_latest_operations: {
        Row: {
          catalog_check_at: string | null
          catalog_check_cost: number | null
          catalog_check_ok: boolean | null
          catalog_check_tokens: number | null
          college_id: string | null
          profile_at: string | null
          profile_cost: number | null
          profile_ok: boolean | null
          profile_tokens: number | null
          retrieval_at: string | null
          retrieval_cost: number | null
          retrieval_ok: boolean | null
          retrieval_tokens: number | null
          test_generation_at: string | null
          test_generation_cost: number | null
          test_generation_ok: boolean | null
          test_generation_tokens: number | null
        }
        Relationships: [
          {
            foreignKeyName: "operation_runs_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "college_stats"
            referencedColumns: ["college_id"]
          },
          {
            foreignKeyName: "operation_runs_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
        ]
      }
      college_stats: {
        Row: {
          attempts_taken: number | null
          college_id: string | null
          course_count: number | null
          department_count: number | null
          last_scraped_at: string | null
          test_set_count: number | null
        }
        Relationships: []
      }
      course_ai_cost: {
        Row: {
          call_count: number | null
          cost_usd: number | null
          course_id: string | null
          total_tokens: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      user_ai_cost: {
        Row: {
          call_count: number | null
          cost_usd: number | null
          total_tokens: number | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

