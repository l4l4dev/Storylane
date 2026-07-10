export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      activity_logs: {
        Row: {
          action: string
          actor_id: string
          created_at: string
          id: string
          payload: Json | null
          project_id: string
          story_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string
          created_at?: string
          id?: string
          payload?: Json | null
          project_id: string
          story_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string
          id?: string
          payload?: Json | null
          project_id?: string
          story_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
      backlog_dividers: {
        Row: {
          created_at: string
          id: string
          kind: string
          label: string
          position: number
          project_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind?: string
          label: string
          position?: number
          project_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          label?: string
          position?: number
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "backlog_dividers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          story_id: string
          updated_at: string
        }
        Insert: {
          author_id?: string
          body: string
          created_at?: string
          id?: string
          story_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          story_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_statuses: {
        Row: {
          color: string
          created_at: string
          id: string
          is_done: boolean
          name: string
          position: number
          project_id: string
          wip_limit: number | null
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          is_done?: boolean
          name: string
          position?: number
          project_id: string
          wip_limit?: number | null
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          is_done?: boolean
          name?: string
          position?: number
          project_id?: string
          wip_limit?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "custom_statuses_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      epics: {
        Row: {
          color: string
          created_at: string
          description: string | null
          id: string
          name: string
          position: number
          project_id: string
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          position?: number
          project_id: string
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          position?: number
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "epics_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          config: Json
          created_at: string
          id: string
          is_active: boolean
          project_id: string
          provider: string
        }
        Insert: {
          config: Json
          created_at?: string
          id?: string
          is_active?: boolean
          project_id: string
          provider: string
        }
        Update: {
          config?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          project_id?: string
          provider?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      iteration_goals: {
        Row: {
          goal: string
          number: number
          project_id: string
          updated_at: string
        }
        Insert: {
          goal: string
          number: number
          project_id: string
          updated_at?: string
        }
        Update: {
          goal?: string
          number?: number
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iteration_goals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      iterations: {
        Row: {
          created_at: string
          end_date: string
          goal: string | null
          id: string
          number: number
          project_id: string
          start_date: string
          state: string
          velocity: number | null
        }
        Insert: {
          created_at?: string
          end_date: string
          goal?: string | null
          id?: string
          number: number
          project_id: string
          start_date: string
          state?: string
          velocity?: number | null
        }
        Update: {
          created_at?: string
          end_date?: string
          goal?: string | null
          id?: string
          number?: number
          project_id?: string
          start_date?: string
          state?: string
          velocity?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "iterations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      labels: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          project_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          project_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "labels_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string
          id: string
          username: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name: string
          id: string
          username: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          id?: string
          username?: string
        }
        Relationships: []
      }
      project_members: {
        Row: {
          is_favorite: boolean
          joined_at: string
          project_id: string
          role: string
          user_id: string
        }
        Insert: {
          is_favorite?: boolean
          joined_at?: string
          project_id: string
          role: string
          user_id: string
        }
        Update: {
          is_favorite?: boolean
          joined_at?: string
          project_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string
          custom_points: number[] | null
          description: string | null
          id: string
          iteration_length: number
          name: string
          point_scale: string
          updated_at: string
          velocity_window: number
          workflow_mode: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string
          custom_points?: number[] | null
          description?: string | null
          id?: string
          iteration_length?: number
          name: string
          point_scale?: string
          updated_at?: string
          velocity_window?: number
          workflow_mode?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string
          custom_points?: number[] | null
          description?: string | null
          id?: string
          iteration_length?: number
          name?: string
          point_scale?: string
          updated_at?: string
          velocity_window?: number
          workflow_mode?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_stories: {
        Row: {
          cadence: string
          created_at: string
          custom_status_id: string | null
          day_of_month: number | null
          description: string | null
          id: string
          is_active: boolean
          last_generated_on: string | null
          project_id: string
          swimlane_id: string | null
          title: string
          weekday: number | null
        }
        Insert: {
          cadence: string
          created_at?: string
          custom_status_id?: string | null
          day_of_month?: number | null
          description?: string | null
          id?: string
          is_active?: boolean
          last_generated_on?: string | null
          project_id: string
          swimlane_id?: string | null
          title: string
          weekday?: number | null
        }
        Update: {
          cadence?: string
          created_at?: string
          custom_status_id?: string | null
          day_of_month?: number | null
          description?: string | null
          id?: string
          is_active?: boolean
          last_generated_on?: string | null
          project_id?: string
          swimlane_id?: string | null
          title?: string
          weekday?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "recurring_stories_lane_project_fkey"
            columns: ["swimlane_id", "project_id"]
            isOneToOne: false
            referencedRelation: "swimlanes"
            referencedColumns: ["id", "project_id"]
          },
          {
            foreignKeyName: "recurring_stories_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_stories_status_project_fkey"
            columns: ["custom_status_id", "project_id"]
            isOneToOne: false
            referencedRelation: "custom_statuses"
            referencedColumns: ["id", "project_id"]
          },
        ]
      }
      stories: {
        Row: {
          assignee_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string
          custom_status_id: string | null
          description: string | null
          epic_id: string | null
          focus: string | null
          id: string
          iteration_id: string | null
          number: number
          points: number | null
          position: number
          project_id: string
          state: string
          story_type: string
          swimlane_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string
          custom_status_id?: string | null
          description?: string | null
          epic_id?: string | null
          focus?: string | null
          id?: string
          iteration_id?: string | null
          number?: number
          points?: number | null
          position?: number
          project_id: string
          state?: string
          story_type?: string
          swimlane_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string
          custom_status_id?: string | null
          description?: string | null
          epic_id?: string | null
          focus?: string | null
          id?: string
          iteration_id?: string | null
          number?: number
          points?: number | null
          position?: number
          project_id?: string
          state?: string
          story_type?: string
          swimlane_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stories_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stories_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stories_custom_status_project_fkey"
            columns: ["custom_status_id", "project_id"]
            isOneToOne: false
            referencedRelation: "custom_statuses"
            referencedColumns: ["id", "project_id"]
          },
          {
            foreignKeyName: "stories_epic_project_fkey"
            columns: ["epic_id", "project_id"]
            isOneToOne: false
            referencedRelation: "epics"
            referencedColumns: ["id", "project_id"]
          },
          {
            foreignKeyName: "stories_iteration_project_fkey"
            columns: ["iteration_id", "project_id"]
            isOneToOne: false
            referencedRelation: "iterations"
            referencedColumns: ["id", "project_id"]
          },
          {
            foreignKeyName: "stories_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stories_swimlane_project_fkey"
            columns: ["swimlane_id", "project_id"]
            isOneToOne: false
            referencedRelation: "swimlanes"
            referencedColumns: ["id", "project_id"]
          },
        ]
      }
      story_labels: {
        Row: {
          label_id: string
          story_id: string
        }
        Insert: {
          label_id: string
          story_id: string
        }
        Update: {
          label_id?: string
          story_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "story_labels_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "labels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "story_labels_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
      swimlanes: {
        Row: {
          created_at: string
          id: string
          name: string
          position: number
          project_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          position?: number
          project_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          position?: number
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "swimlanes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          created_at: string
          id: string
          is_done: boolean
          position: number
          story_id: string
          title: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_done?: boolean
          position?: number
          story_id: string
          title: string
        }
        Update: {
          created_at?: string
          id?: string
          is_done?: boolean
          position?: number
          story_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      copy_story_to_project: {
        Args: { p_story_id: string; p_target_project_id: string }
        Returns: Json
      }
      finalize_iteration: {
        Args: { p_manual: boolean; p_project_id: string }
        Returns: Json
      }
      generate_recurring_stories: {
        Args: { p_project_id: string }
        Returns: undefined
      }
      generate_username: { Args: { base: string }; Returns: string }
      invite_member: {
        Args: { p_project_id: string; p_role?: string; p_user_id: string }
        Returns: undefined
      }
      is_project_member: { Args: { p_project_id: string }; Returns: boolean }
      move_story_to_project: {
        Args: { p_story_id: string; p_target_project_id: string }
        Returns: Json
      }
      project_role: { Args: { p_project_id: string }; Returns: string }
      promote_story_to_epic: { Args: { p_story_id: string }; Returns: Json }
      search_users_for_invite: {
        Args: { p_project_id: string; p_query: string }
        Returns: {
          avatar_url: string
          display_name: string
          id: string
          username: string
        }[]
      }
      search_users_for_new_project: {
        Args: { p_query: string }
        Returns: {
          avatar_url: string
          display_name: string
          id: string
          username: string
        }[]
      }
      shares_project_with: {
        Args: { p_target_user_id: string }
        Returns: boolean
      }
      toggle_project_favorite: {
        Args: { p_favorite: boolean; p_project_id: string }
        Returns: undefined
      }
      update_story: {
        Args: {
          p_assignee_id: string
          p_custom_status_id: string
          p_description: string
          p_epic_id: string
          p_label_ids?: string[]
          p_points: number
          p_story_id: string
          p_story_type: string
          p_title: string
        }
        Returns: {
          assignee_id: string
          custom_status_id: string
          description: string
          epic_id: string
          id: string
          label_ids: string[]
          number: number
          points: number
          project_id: string
          state: string
          story_type: string
          title: string
        }[]
      }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

