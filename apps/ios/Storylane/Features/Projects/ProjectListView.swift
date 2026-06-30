import SwiftUI

struct ProjectListView: View {
    @Environment(AuthManager.self) private var auth
    @State private var viewModel = ProjectListViewModel()
    @State private var showingCreate = false

    var body: some View {
        NavigationStack {
            Group {
                if viewModel.isLoading && viewModel.projects.isEmpty {
                    ProgressView()
                } else if viewModel.projects.isEmpty {
                    ContentUnavailableView(
                        "No projects",
                        systemImage: "folder",
                        description: Text("Create your first project to get started.")
                    )
                } else {
                    List(viewModel.projects) { project in
                        NavigationLink(value: project) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(project.name).font(.headline)
                                if let description = project.description, !description.isEmpty {
                                    Text(description)
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Projects")
            .navigationDestination(for: Project.self) { project in
                ProjectSettingsView(project: project)
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Sign out") {
                        Task { try? await auth.signOut() }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showingCreate = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showingCreate) {
                CreateProjectSheet(viewModel: viewModel)
            }
            .task { await viewModel.load() }
        }
    }
}
