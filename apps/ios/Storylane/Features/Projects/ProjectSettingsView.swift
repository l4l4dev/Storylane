import SwiftUI

struct ProjectSettingsView: View {
    @State private var viewModel: ProjectSettingsViewModel
    @State private var inviteEmail = ""
    @State private var inviteRole = "member"

    init(project: Project) {
        _viewModel = State(initialValue: ProjectSettingsViewModel(project: project))
    }

    var body: some View {
        Form {
            Section("Details") {
                TextField("Name", text: $viewModel.project.name)
                TextField("Description", text: Binding(
                    get: { viewModel.project.description ?? "" },
                    set: { viewModel.project.description = $0.isEmpty ? nil : $0 }
                ), axis: .vertical)
                Picker("Iteration length", selection: $viewModel.project.iterationLength) {
                    ForEach(ProjectOptions.iterationLengths, id: \.self) { Text("\($0) days").tag($0) }
                }
                Picker("Point scale", selection: $viewModel.project.pointScale) {
                    ForEach(ProjectOptions.pointScales, id: \.self) { Text($0).tag($0) }
                }
                Stepper("Velocity window: \(viewModel.project.velocityWindow)",
                        value: $viewModel.project.velocityWindow, in: 1...10)
                Button("Save changes") {
                    Task { await viewModel.saveProject() }
                }
            }

            Section("Invite member") {
                TextField("email@example.com", text: $inviteEmail)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                Picker("Role", selection: $inviteRole) {
                    ForEach(ProjectOptions.roles, id: \.self) { Text($0).tag($0) }
                }
                Button("Invite") {
                    let email = inviteEmail.trimmingCharacters(in: .whitespaces)
                    guard !email.isEmpty else { return }
                    Task {
                        await viewModel.invite(email: email, role: inviteRole)
                        inviteEmail = ""
                    }
                }
            }

            Section("Members") {
                ForEach(viewModel.members) { member in
                    HStack {
                        Text(member.displayName)
                        Spacer()
                        Text(member.role)
                            .foregroundStyle(.secondary)
                    }
                    .swipeActions {
                        Button("Remove", role: .destructive) {
                            Task { await viewModel.remove(userId: member.userId) }
                        }
                    }
                }
            }

            if let errorMessage = viewModel.errorMessage {
                Section {
                    Text(errorMessage).foregroundStyle(.red)
                }
            }
        }
        .navigationTitle(viewModel.project.name)
        .navigationBarTitleDisplayMode(.inline)
        .task { await viewModel.loadMembers() }
    }
}
