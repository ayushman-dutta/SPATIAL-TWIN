from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    POSTGRES_USER: str = "spatial_user"
    POSTGRES_PASSWORD: str = "spatial_twin_secret_dev"
    POSTGRES_DB: str = "spatial_twin"
    POSTGRES_HOST: str = "127.0.0.1"
    POSTGRES_PORT: int = 5432

    OLLAMA_BASE_URL: str = "http://127.0.0.1:11434"
    OLLAMA_MODEL: str = "qwen2.5:3b"
    STATIC_ASSETS_DIR: str = "./static"
    PIPELINE_WORKSPACE: str = "./output/reconstruction_jobs"
    PIPELINE_MAX_INPUT_BYTES: int = 4 * 1024 * 1024 * 1024
    PIPELINE_STAGE_TIMEOUT_SECONDS: int = 6 * 60 * 60
    COLMAP_EXECUTABLE: str = ""
    KAGGLE_USERNAME: str = ""
    KAGGLE_KEY: str = ""

    @property
    def database_url(self) -> str:
        return f"postgresql://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

settings = Settings()
