import SwiftUI

struct BacklogView: View {
    @State private var viewModel: BacklogViewModel
    @State private var showingCreate = false

    init(project: Project) {
        _viewModel = State(initialValue: BacklogViewModel(project: project))
    }

    var body: some View {
        Group {
            if viewModel.isLoading && viewModel.stories.isEmpty {
                ProgressView()
            } else if viewModel.stories.isEmpty {
                ContentUnavailableView(
                    "No stories",
                    systemImage: "doc.text",
                    description: Text("Tap + to add your first story.")
                )
            } else {
                storyList
            }
        }
        .navigationTitle(viewModel.project.name)
        .navigationBarTitleDisplayMode(.large)
        .navigationDestination(for: Story.self) { story in
            StoryDetailView(story: story)
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink {
                    ProjectSettingsView(project: viewModel.project)
                } label: {
                    Image(systemName: "gear")
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button { showingCreate = true } label: {
                    Image(systemName: "plus")
                }
            }
        }
        .sheet(
            isPresented: $showingCreate,
            onDismiss: { Task { await viewModel.load() } },
            content: { StoryEditView(projectId: viewModel.project.id, story: nil) }
        )
        .alert("Error", isPresented: Binding(
            get: { viewModel.errorMessage != nil },
            set: { if !$0 { viewModel.errorMessage = nil } }
        )) {
            Button("OK") { viewModel.errorMessage = nil }
        } message: {
            Text(viewModel.errorMessage ?? "")
        }
        .onAppear { Task { await viewModel.load() } }
        .refreshable { await viewModel.load() }
    }

    private var storyList: some View {
        List(viewModel.stories) { story in
            NavigationLink(value: story) {
                StoryRowView(story: story)
            }
            .swipeActions(edge: .leading, allowsFullSwipe: true) {
                if let advanceLabel = story.state.advanceLabel {
                    Button(advanceLabel) {
                        Task { await viewModel.advanceState(for: story) }
                    }
                    .tint(.blue)
                }
            }
            .swipeActions(edge: .trailing) {
                Button("Delete", role: .destructive) {
                    Task { await viewModel.deleteStory(story) }
                }
                if story.state == .delivered {
                    Button("Reject", role: .destructive) {
                        Task { await viewModel.rejectStory(story) }
                    }
                    .tint(.orange)
                }
            }
        }
    }
}

struct StoryRowView: View {
    let story: Story

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: story.storyType.icon)
                .foregroundStyle(story.storyType.rowColor)
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text(story.title)
                    .font(.body)
                Text(story.state.displayName)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if let points = story.points {
                Text("\(points)")
                    .font(.caption.monospacedDigit())
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(.secondary.opacity(0.15))
                    .clipShape(Capsule())
            }
        }
        .padding(.vertical, 2)
    }
}

private extension StoryType {
    var rowColor: Color {
        switch self {
        case .feature: .yellow
        case .bug: .red
        case .chore: .gray
        case .release: .purple
        }
    }
}
