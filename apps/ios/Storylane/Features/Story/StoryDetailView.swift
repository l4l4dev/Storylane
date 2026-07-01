import SwiftUI

struct StoryDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var viewModel: StoryDetailViewModel
    @State private var showingEdit = false
    @State private var showDeleteConfirm = false

    init(story: Story) {
        _viewModel = State(initialValue: StoryDetailViewModel(story: story))
    }

    var body: some View {
        List {
            stateSection
            detailSection
            if let desc = viewModel.story.description, !desc.isEmpty {
                descriptionSection(desc)
            }
            deleteSection
        }
        .navigationTitle(viewModel.story.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Edit") { showingEdit = true }
            }
        }
        .sheet(
            isPresented: $showingEdit,
            onDismiss: { Task { await viewModel.reloadStory() } },
            content: { StoryEditView(projectId: viewModel.story.projectId, story: viewModel.story) }
        )
        .confirmationDialog(
            "Delete story?",
            isPresented: $showDeleteConfirm,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                Task {
                    if await viewModel.deleteStory() { dismiss() }
                }
            }
        }
        .alert("Error", isPresented: Binding(
            get: { viewModel.errorMessage != nil },
            set: { if !$0 { viewModel.errorMessage = nil } }
        )) {
            Button("OK") { viewModel.errorMessage = nil }
        } message: {
            Text(viewModel.errorMessage ?? "")
        }
    }

    private var stateSection: some View {
        Section("State") {
            LabeledContent("Current", value: viewModel.story.state.displayName)
            if let advanceLabel = viewModel.story.state.advanceLabel {
                Button(advanceLabel) {
                    Task { await viewModel.advanceState() }
                }
            }
            if viewModel.story.state == .delivered {
                Button("Reject") {
                    Task { await viewModel.rejectStory() }
                }
                .foregroundStyle(.orange)
            }
        }
    }

    private var detailSection: some View {
        Section("Details") {
            LabeledContent("Type", value: viewModel.story.storyType.label)
            if let points = viewModel.story.points {
                LabeledContent("Points", value: "\(points)")
            }
        }
    }

    private func descriptionSection(_ text: String) -> some View {
        Section("Description") {
            Text(text)
                .font(.body)
                .foregroundStyle(.primary)
        }
    }

    private var deleteSection: some View {
        Section {
            Button("Delete story", role: .destructive) {
                showDeleteConfirm = true
            }
        }
    }
}
