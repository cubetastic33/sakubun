FROM rustlang/rust:nightly

# Install Node.js and npm
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs

# Install latest Dart Sass via npm
RUN npm install -g sass

# Set the working directory
WORKDIR /app

# Copy source files into the Docker image
COPY . .

# Compile Sass
RUN sass static/styles/:static/styles/ --style compressed

# Build the program
RUN cargo build --release

# Run the built binary
CMD ["./target/release/sakubun"]
