import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "checklist")
                .font(.largeTitle)
            Text("Storylane")
                .font(.title2)
                .bold()
        }
        .padding()
    }
}

#Preview {
    ContentView()
}
