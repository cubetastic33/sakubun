FROM rustlang/rust:nightly

# Copy source files into the Docker image
COPY . .

# Build the program
RUN cargo build --release

# Run the built binary
CMD ["./target/release/sakubun"]

EXPOSE 3000
