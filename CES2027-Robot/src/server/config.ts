export type ServiceType = "postgres";

const serviceType = process.env.SERVICE_TYPE ?? "postgres";

if (serviceType !== "postgres") {
    throw new Error(`Unsupported SERVICE_TYPE: ${serviceType}`);
}

export const config = {
    serviceType: serviceType as ServiceType,
    databaseUrl: process.env.DATABASE_URL ?? "postgresql://root:root@localhost:5432/ces2027",
    gcpProjectId: process.env.GCP_PROJECT_ID,
    gcsBucketName: process.env.GCS_BUCKET_NAME,
    googleApplicationCredentials: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    vertexLocation: process.env.VERTEX_LOCATION ?? "us-central1",
    vertexChatModel: process.env.VERTEX_CHAT_MODEL ?? "gemini-2.5-flash",
    vertexEmbeddingModel: process.env.VERTEX_EMBEDDING_MODEL ?? "text-embedding-005",
    vertexEmbeddingDimensions: Number(process.env.VERTEX_EMBEDDING_DIMENSIONS ?? 768),
};