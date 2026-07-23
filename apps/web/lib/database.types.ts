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
          {
            foreignKeyName: "activity_logs_story_project_fk"
            columns: ["story_id", "project_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id", "project_id"]
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
          webhook_secret: string | null
        }
        Insert: {
          config: Json
          created_at?: string
          id?: string
          is_active?: boolean
          project_id: string
          provider: string
          webhook_secret?: string | null
        }
        Update: {
          config?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          project_id?: string
          provider?: string
          webhook_secret?: string | null
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
          capacity: number | null
          created_at: string
          end_date: string
          goal: string | null
          id: string
          number: number
          project_id: string
          skipped: boolean
          start_date: string
          state: string
          velocity: number | null
        }
        Insert: {
          capacity?: number | null
          created_at?: string
          end_date: string
          goal?: string | null
          id?: string
          number: number
          project_id: string
          skipped?: boolean
          start_date: string
          state?: string
          velocity?: number | null
        }
        Update: {
          capacity?: number | null
          created_at?: string
          end_date?: string
          goal?: string | null
          id?: string
          number?: number
          project_id?: string
          skipped?: boolean
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
      my_work_columns: {
        Row: {
          created_at: string
          id: string
          name: string
          position: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          position: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          position?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "my_work_columns_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      my_work_story_state: {
        Row: {
          column_id: string | null
          column_position: number | null
          done_position: number | null
          story_id: string
          today_date: string | null
          today_position: number | null
          todo_position: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          column_id?: string | null
          column_position?: number | null
          done_position?: number | null
          story_id: string
          today_date?: string | null
          today_position?: number | null
          todo_position?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          column_id?: string | null
          column_position?: number | null
          done_position?: number | null
          story_id?: string
          today_date?: string | null
          today_position?: number | null
          todo_position?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "my_work_story_state_column_fk"
            columns: ["user_id", "column_id"]
            isOneToOne: false
            referencedRelation: "my_work_columns"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "my_work_story_state_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "my_work_story_state_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
          is_agent: boolean
          my_work_column_names: Json
          my_work_column_order: string[]
          my_work_done_window_days: number
          username: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name: string
          id: string
          is_agent?: boolean
          my_work_column_names?: Json
          my_work_column_order?: string[]
          my_work_done_window_days?: number
          username: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          id?: string
          is_agent?: boolean
          my_work_column_names?: Json
          my_work_column_order?: string[]
          my_work_done_window_days?: number
          username?: string
        }
        Relationships: []
      }
      project_calendar_exceptions: {
        Row: {
          date: string
          id: string
          kind: string
          project_id: string
        }
        Insert: {
          date: string
          id?: string
          kind: string
          project_id: string
        }
        Update: {
          date?: string
          id?: string
          kind?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_calendar_exceptions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
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
      project_states: {
        Row: {
          action_label: string | null
          category: string
          created_at: string
          id: string
          name: string
          position: number
          project_id: string
        }
        Insert: {
          action_label?: string | null
          category: string
          created_at?: string
          id?: string
          name: string
          position?: number
          project_id: string
        }
        Update: {
          action_label?: string | null
          category?: string
          created_at?: string
          id?: string
          name?: string
          position?: number
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_states_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
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
          is_personal: boolean
          iteration_length: number
          iteration_term: string
          name: string
          point_scale: string
          state_template: string
          updated_at: string
          velocity_window: number
          working_weekdays: number[]
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string
          custom_points?: number[] | null
          description?: string | null
          id?: string
          is_personal?: boolean
          iteration_length?: number
          iteration_term?: string
          name: string
          point_scale?: string
          state_template?: string
          updated_at?: string
          velocity_window?: number
          working_weekdays?: number[]
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string
          custom_points?: number[] | null
          description?: string | null
          id?: string
          is_personal?: boolean
          iteration_length?: number
          iteration_term?: string
          name?: string
          point_scale?: string
          state_template?: string
          updated_at?: string
          velocity_window?: number
          working_weekdays?: number[]
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
      slack_notifications: {
        Row: {
          created_at: string
          event_type: string
          id: string
          project_id: string
          ref_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          project_id: string
          ref_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          project_id?: string
          ref_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "slack_notifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      stories: {
        Row: {
          assignee_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string
          description: string | null
          epic_id: string | null
          id: string
          iteration_id: string | null
          number: number
          points: number | null
          position: number
          project_id: string
          state_id: string | null
          story_type: string
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          epic_id?: string | null
          id?: string
          iteration_id?: string | null
          number?: number
          points?: number | null
          position?: number
          project_id: string
          state_id?: string | null
          story_type?: string
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          epic_id?: string | null
          id?: string
          iteration_id?: string | null
          number?: number
          points?: number | null
          position?: number
          project_id?: string
          state_id?: string | null
          story_type?: string
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
            foreignKeyName: "stories_state_project_fkey"
            columns: ["state_id", "project_id"]
            isOneToOne: false
            referencedRelation: "project_states"
            referencedColumns: ["id", "project_id"]
          },
        ]
      }
      story_completions: {
        Row: {
          completed_at: string
          id: string
          story_id: string
          user_id: string
        }
        Insert: {
          completed_at?: string
          id?: string
          story_id: string
          user_id: string
        }
        Update: {
          completed_at?: string
          id?: string
          story_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "story_completions_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "story_completions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
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
      user_time_off: {
        Row: {
          date: string
          kind: string
          user_id: string
        }
        Insert: {
          date: string
          kind: string
          user_id: string
        }
        Update: {
          date?: string
          kind?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_time_off_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _grant_audit: {
        Args: never
        Returns: {
          anon: boolean
          auth: boolean
          name: string
        }[]
      }
      _resequence_backlog: {
        Args: {
          p_divider_ids: string[]
          p_kinds: string[]
          p_story_ids: string[]
        }
        Returns: undefined
      }
      _splice_backlog: {
        Args: {
          p_before_id: string
          p_before_kind: string
          p_id: string
          p_kind: string
          p_project_id: string
        }
        Returns: undefined
      }
      assert_not_last_owner: {
        Args: { p_project_id: string; p_user_id: string }
        Returns: undefined
      }
      change_member_role: {
        Args: { p_project_id: string; p_role: string; p_user_id: string }
        Returns: undefined
      }
      copy_story_to_project: {
        Args: { p_story_id: string; p_target_project_id: string }
        Returns: Json
      }
      create_project_state: {
        Args: {
          p_action_label?: string
          p_category: string
          p_name: string
          p_project_id: string
        }
        Returns: string
      }
      create_story_tracker: {
        Args: {
          p_description: string
          p_epic_id: string
          p_iteration_id: string
          p_label_ids: string[]
          p_points: number
          p_project_id: string
          p_state_id: string
          p_story_type: string
          p_title: string
        }
        Returns: {
          id: string
          iteration_id: string
          number: number
          state_id: string
          title: string
        }[]
      }
      finalize_iteration: {
        Args: {
          p_iteration_id?: string
          p_manual: boolean
          p_project_id: string
        }
        Returns: Json
      }
      finish_story_from_git: {
        Args: {
          p_project_id: string
          p_provider: string
          p_story_number: number
        }
        Returns: Json
      }
      generate_username: { Args: { base: string }; Returns: string }
      insert_board_item: {
        Args: {
          p_anchor: Json
          p_kind: string
          p_payload: Json
          p_project_id: string
        }
        Returns: string
      }
      invite_member: {
        Args: { p_project_id: string; p_role?: string; p_user_id: string }
        Returns: undefined
      }
      is_project_member: { Args: { p_project_id: string }; Returns: boolean }
      move_story_board: {
        Args: {
          p_anchor: Json
          p_deltas: Json
          p_expected: Json
          p_item: Json
          p_project_id: string
          p_view: string
        }
        Returns: undefined
      }
      move_story_to_project: {
        Args: { p_story_id: string; p_target_project_id: string }
        Returns: Json
      }
      next_working_day: {
        Args: { p_from: string; p_project_id: string }
        Returns: string
      }
      notify_slack_event: {
        Args: { p_project_id: string; p_ref_id: string; p_type: string }
        Returns: undefined
      }
      override_iteration_length: {
        Args: { p_end_date: string; p_iteration_id: string }
        Returns: Json
      }
      project_capacity: {
        Args: { p_end: string; p_project_id: string; p_start: string }
        Returns: number
      }
      project_role: { Args: { p_project_id: string }; Returns: string }
      promote_story_to_epic: { Args: { p_story_id: string }; Returns: Json }
      remove_member: {
        Args: { p_project_id: string; p_user_id: string }
        Returns: undefined
      }
      reorder_project_state: {
        Args: { p_direction: string; p_project_id: string; p_state_id: string }
        Returns: undefined
      }
      require_project_role: {
        Args: { p_project_id: string; p_roles: string[] }
        Returns: undefined
      }
      reshape_current_iteration: {
        Args: { p_project_id: string }
        Returns: Json
      }
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
      seed_project_states: {
        Args: { p_project_id: string; p_template: string }
        Returns: undefined
      }
      set_story_labels: {
        Args: { p_label_ids: string[]; p_story_id: string }
        Returns: undefined
      }
      set_story_state: {
        Args: { p_state_id: string; p_story_id: string }
        Returns: Json
      }
      set_story_tasks: {
        Args: { p_story_id: string; p_tasks: Json }
        Returns: {
          created_at: string
          id: string
          is_done: boolean
          position: number
          story_id: string
          title: string
        }[]
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: false
          isSetofReturn: true
        }
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
          description: string
          epic_id: string
          id: string
          label_ids: string[]
          number: number
          points: number
          project_id: string
          state_id: string
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

