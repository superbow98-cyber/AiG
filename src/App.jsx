// AiG — App Root
// React Router setup + Auth provider wrapper
// Routes: / login | /dashboard | /upload | /preprocess | /visualise
//         /detect | /classify | /cluster | /database | /results | /settings
// TODO: implement routing and auth guard
import { BrowserRouter } from 'react-router-dom';

export default function App() {
  return (
    <BrowserRouter>
      <div>AiG — loading...</div>
    </BrowserRouter>
  );
}
