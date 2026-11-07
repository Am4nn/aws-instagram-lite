import { AppNav } from "../../components/AppNav";
import { NewPostForm } from "../../components/new/NewPostForm";

export default function NewPost() {
  return (
    <>
      <AppNav />
      <main className="feed">
        <NewPostForm />
      </main>
    </>
  );
}
