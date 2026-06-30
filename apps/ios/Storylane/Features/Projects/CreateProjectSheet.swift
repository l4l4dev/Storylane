import SwiftUI

struct CreateProjectSheet: View {
    let viewModel: ProjectListViewModel

    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var description = ""
    @State private var iterationLength = 14
    @State private var pointScale = "fibonacci"
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Project") {
                    TextField("Name", text: $name)
                    TextField("Description", text: $description, axis: .vertical)
                }
                Section("Settings") {
                    Picker("Iteration length", selection: $iterationLength) {
                        ForEach(ProjectOptions.iterationLengths, id: \.self) { days in
                            Text("\(days) days").tag(days)
                        }
                    }
                    Picker("Point scale", selection: $pointScale) {
                        ForEach(ProjectOptions.pointScales, id: \.self) { scale in
                            Text(scale).tag(scale)
                        }
                    }
                }
            }
            .navigationTitle("New Project")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") { save() }
                        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || isSaving)
                }
            }
        }
    }

    private func save() {
        isSaving = true
        Task {
            let ok = await viewModel.createProject(
                name: name.trimmingCharacters(in: .whitespaces),
                description: description.isEmpty ? nil : description,
                iterationLength: iterationLength,
                pointScale: pointScale
            )
            isSaving = false
            if ok { dismiss() }
        }
    }
}
