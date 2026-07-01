import SwiftUI

struct StoryEditView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var viewModel: StoryEditViewModel

    init(projectId: UUID, story: Story?) {
        _viewModel = State(initialValue: StoryEditViewModel(projectId: projectId, story: story))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Title") {
                    TextField("Story title", text: $viewModel.title, axis: .vertical)
                        .lineLimit(2...4)
                }

                Section("Details") {
                    Picker("Type", selection: $viewModel.storyType) {
                        ForEach(StoryType.allCases, id: \.self) { type in
                            Label(type.label, systemImage: type.icon).tag(type)
                        }
                    }
                    if viewModel.storyType.usesPoints {
                        TextField("Points", text: $viewModel.pointsText)
                            .keyboardType(.numberPad)
                    }
                }

                Section("Description") {
                    TextField(
                        "Optional notes...",
                        text: $viewModel.descriptionText,
                        axis: .vertical
                    )
                    .lineLimit(3...8)
                }

                if let errorMessage = viewModel.errorMessage {
                    Section {
                        Text(errorMessage).foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle(viewModel.isEditMode ? "Edit story" : "New story")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(viewModel.isEditMode ? "Save" : "Create") {
                        Task {
                            if await viewModel.save() { dismiss() }
                        }
                    }
                    .disabled(viewModel.isSaveDisabled)
                }
            }
        }
    }
}
